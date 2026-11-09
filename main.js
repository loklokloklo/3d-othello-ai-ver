// ============================================================
// 3Dオセロ（4×4×4）— AI対戦版（1手戻す機能つき）
//
// 1手戻す機能の方針:
//   - 棋譜（moveHistory）から「人間の直前の1手」と「それ以降のAIの手」を削除し、
//     初期配置から棋譜を再生して盤面を作り直す（人間版と同じ方式）。
//   - 戻した後は必ず人間の手番になる。
//   - AIの思考中（サーバー応答待ち）に戻した場合は、aiRequestToken を進めて
//     古いAI応答を無効化する。
// ============================================================

import * as THREE from './libs/three.module.js';
import { OrbitControls } from './libs/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from './libs/CSS2DRenderer.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getDatabase, ref, push, set } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-database.js";

window.init = init;


// ============================================================
// 定数・グローバル状態
// ============================================================

// --- Three.js 関連 ---
let scene, camera, renderer, labelRenderer, controls;
let boardGroup;

// --- ゲーム状態 ---
let board = [];                 // board[x][y][z] = 'black' | 'white' | null
let currentTurn = null;         // 現在の手番（'black' または 'white'）
let gameStarted = false;
let firstPlayer = 'black';      // プレイヤー（人間）が選んだ色（記録用）
let aiColor;                    // AIの色
let aicannot = false;           // サーバーが使えずローカルAIで代替したか

// --- 着手の記録 ---
const moveHistory = [];         // { player, move: [x,y,z] } または { player, pass: true }
const placedStones = new Set(); // 着手済みマスのキー "x,y,z"
let lastPlacedStone = null;     // 直前に置いた石の座標 [x, y, z]
let lastPlacedColor = null;     // 直前に置いた石の色

// --- 1手戻す機能用 ---
let isPassPopupVisible = false; // パス通知ポップアップの表示中フラグ
let aiRequestToken = 0;         // AI思考の世代番号。戻し・終局で進め、古いAI応答を無効化する

// --- 石の表示 ---
const stoneMap = new Map();     // キー "x,y,z" → 石の Mesh
const stoneRadius = 0.3;

// --- 盤面の寸法 ---
const size = 4;
const spacing = 1.2;

// 26方向（3次元の隣接方向）
const directions = [];
for (let dx = -1; dx <= 1; dx++) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx !== 0 || dy !== 0 || dz !== 0) {
        directions.push([dx, dy, dz]);
      }
    }
  }
}

// --- Firebase（棋譜の保存先） ---
const firebaseConfig = {
  apiKey: "AIzaSyDpXdLFl05RGNS7sh0FEbFAtcM8aWgMVvg",
  authDomain: "d-othello.firebaseapp.com",
  projectId: "d-othello",
  storageBucket: "d-othello.firebasestorage.app",
  messagingSenderId: "895908988417",
  appId: "1:895908988417:web:6726542c927ad8d9c36200",
  databaseURL: "https://d-othello-default-rtdb.firebaseio.com/"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);


// ============================================================
// 初期化
// ============================================================

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#ccffd0');

  camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(10, 10, 10);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor('#ccffd0');
  document.body.appendChild(renderer.domElement);

  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  document.body.appendChild(labelRenderer.domElement);

  controls = new OrbitControls(camera, labelRenderer.domElement);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.target.set(3, 3, 3);

  // ライト
  scene.add(new THREE.AmbientLight(0xffffff, 5));

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 10, 10);
  scene.add(directionalLight);

  scene.add(new THREE.AxesHelper(10));

  // 盤面データを空で初期化
  for (let x = 0; x < size; x++) {
    board[x] = [];
    for (let y = 0; y < size; y++) {
      board[x][y] = [];
      for (let z = 0; z < size; z++) {
        board[x][y][z] = null;
      }
    }
  }

  // ボード作成
  boardGroup = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);

  // 透明なマテリアル（クリック判定用）
  const transparentMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0
  });

  // ワイヤーフレーム（薄い灰色の枠線）
  const wireframeMaterial = new THREE.MeshBasicMaterial({
    color: 0xaaaaaa,
    wireframe: true
  });

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        const cube = new THREE.Mesh(geometry, transparentMaterial);
        const wireframe = new THREE.Mesh(geometry, wireframeMaterial);

        const boxGroup = new THREE.Group();
        boxGroup.add(cube);
        boxGroup.add(wireframe);

        boxGroup.position.set(
          (x + 1.0) * spacing,
          (y + 1.0) * spacing,
          (z + 1.0) * spacing
        );

        boardGroup.add(boxGroup);
      }
    }
  }

  scene.add(boardGroup);

  // 初期配置（黒＝0x000000、白＝0xffffff）
  createStone(1, 1, 1, 0x000000);
  board[1][1][1] = 'black';
  createStone(2, 2, 1, 0x000000);
  board[2][2][1] = 'black';
  createStone(2, 1, 2, 0x000000);
  board[2][1][2] = 'black';
  createStone(1, 2, 2, 0x000000);
  board[1][2][2] = 'black';

  createStone(1, 2, 1, 0xffffff);
  board[1][2][1] = 'white';
  createStone(2, 2, 2, 0xffffff);
  board[2][2][2] = 'white';
  createStone(1, 1, 2, 0xffffff);
  board[1][1][2] = 'white';
  createStone(2, 1, 1, 0xffffff);
  board[2][1][1] = 'white';

  // 軸（X: 赤 / Y: 緑 / Z: 青）
  const axisLength = 5;
  const axisDefs = [
    { color: 0xff0000, end: new THREE.Vector3(axisLength, 0, 0) },
    { color: 0x00ff00, end: new THREE.Vector3(0, axisLength, 0) },
    { color: 0x0000ff, end: new THREE.Vector3(0, 0, axisLength) }
  ];
  for (const { color, end } of axisDefs) {
    const material = new THREE.LineBasicMaterial({ color });
    const axisGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      end
    ]);
    scene.add(new THREE.Line(axisGeometry, material));
  }

  // 軸ラベル
  createAxisLabel('X', (4 + 0.5) * spacing, 0, 0);
  createAxisLabel('Y', 0, (4 + 0.5) * spacing, 0);
  createAxisLabel('Z', 0, 0, (4 + 0.5) * spacing);

  updateStoneCountDisplay();
  animate();

  setupUndoButtons();
}

function createAxisLabel(text, x, y, z) {
  const div = document.createElement('div');
  div.className = 'label';
  div.textContent = text;
  const label = new CSS2DObject(div);
  label.position.set(x, y, z);
  scene.add(label);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

/** 「1手戻す」ボタン（通常時・パスポップアップ内）のイベントを登録する */
function setupUndoButtons() {
  const undoButton = document.getElementById('undo-button');
  if (undoButton) {
    undoButton.addEventListener('click', () => {
      undoLastMove();
    });
  }

  const passUndoButton = document.getElementById('pass-undo-button');
  if (passUndoButton) {
    passUndoButton.addEventListener('click', () => {
      if (!canUndo()) return;
      hidePassPopup();
      undoCore();
    });
  }
}


// ============================================================
// 対局開始（手番選択画面）
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  const turnUI = document.getElementById('turn-selection');
  const blackButton = document.getElementById('black-button');
  const whiteButton = document.getElementById('white-button');

  if (blackButton && whiteButton && turnUI) {
    // プレイヤーが先手（黒）
    blackButton.addEventListener('click', () => {
      aiColor = 'white';
      firstPlayer = 'black';
      currentTurn = 'black';
      turnUI.style.display = 'none';
      gameStarted = true;
      showAllLegalMoves();

      setTimeout(() => {
        setupPointerListener();
      }, 100);

      if (currentTurn === aiColor) {
        handleAITurn();
      }
    });

    // プレイヤーが後手（白）。AIが先に打つ
    whiteButton.addEventListener('click', () => {
      aiColor = 'black';
      firstPlayer = 'white';
      currentTurn = 'black';
      turnUI.style.display = 'none';
      gameStarted = true;
      showAllLegalMoves();

      setTimeout(() => {
        setupPointerListener();
      }, 100);

      if (currentTurn === aiColor) {
        handleAITurn();
      }
    });
  } else {
    console.error("❌ ボタンやUIが見つかりません");
  }
});


// ============================================================
// 石の描画
// ============================================================

/**
 * 石（球）を作成してシーンに追加する。
 * @param {boolean} isLastPlaced 直前のAIの着手なら、目印として赤みのある色で描画する
 */
function createStone(x, y, z, color, isLastPlaced = false) {
  let finalColor = color;

  if (isLastPlaced) {
    // 黒ならダークレッド寄り、白ならピンク寄り
    finalColor = (color === 0x000000) ? 0x4B0000 : 0xAA6666;
  }

  const geometry = new THREE.SphereGeometry(stoneRadius, 32, 32);
  const material = new THREE.MeshStandardMaterial({ color: finalColor });
  const stone = new THREE.Mesh(geometry, material);
  stone.position.set(
    (x + 1.0) * spacing,
    (y + 1.0) * spacing,
    (z + 1.0) * spacing
  );
  scene.add(stone);

  stoneMap.set(`${x},${y},${z}`, stone);
}

/** 直前に置いた石の強調表示を、通常の色に戻す */
function revertPreviousRedStone(color) {
  if (!lastPlacedStone) return;

  const [x, y, z] = lastPlacedStone;
  const mesh = stoneMap.get(`${x},${y},${z}`);
  if (mesh) {
    mesh.material.color.set(color);
  }
}

/** 指定マスにある石のメッシュをシーンから削除する */
function removeStoneAt(x, y, z) {
  const targetPosition = new THREE.Vector3(
    (x + 1.0) * spacing,
    (y + 1.0) * spacing,
    (z + 1.0) * spacing
  );

  const toRemove = scene.children.find(obj =>
    obj instanceof THREE.Mesh &&
    obj.geometry.type === "SphereGeometry" &&
    obj.position.distanceTo(targetPosition) < 0.01
  );

  if (toRemove) {
    scene.remove(toRemove);
  }
}


// ============================================================
// 人間の着手（クリック入力）
// ============================================================

function setupPointerListener() {
  window.addEventListener('pointerdown', handlePointerDownOnce);
}

function handlePointerDownOnce(event) {
  if (!gameStarted || !firstPlayer) return;
  if (isPassPopupVisible) return;          // パス通知の表示中は盤面を操作させない
  if (currentTurn === aiColor) return;     // AIの手番中は操作させない

  // ボタン（1手戻す等）を押したときに、背後の盤面へ石が置かれないようにする
  if (event.target instanceof Element && event.target.closest('button')) return;

  const mouse = new THREE.Vector2();
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(boardGroup.children, true);
  if (intersects.length === 0) return;

  const point = intersects[0].object.parent.position;
  const x = Math.round(point.x / spacing) - 1;
  const y = Math.round(point.y / spacing) - 1;
  const z = Math.round(point.z / spacing) - 1;

  const key = `${x},${y},${z}`;
  if (placedStones.has(key)) return;
  if (!isLegalMove(board, x, y, z, currentTurn)) return;

  // 石を置く前に、前の赤い石を元の色に戻す
  if (lastPlacedStone) {
    const prevColor = lastPlacedColor === 'black' ? 0x000000 : 0xffffff;
    revertPreviousRedStone(prevColor);
  }

  const color = currentTurn === 'black' ? 0x000000 : 0xffffff;
  createStone(x, y, z, color, false);

  board[x][y][z] = currentTurn;
  placedStones.add(key);
  moveHistory.push({ player: currentTurn, move: [x, y, z] });

  lastPlacedStone = [x, y, z];
  lastPlacedColor = currentTurn;

  // 反転処理は、手番を切り替える前に行う
  flipStones(x, y, z, currentTurn);
  currentTurn = currentTurn === 'black' ? 'white' : 'black';

  updateStoneCountDisplay();
  showAllLegalMoves();

  // 次はAIの手番
  if (currentTurn === aiColor) {
    handleAITurn();
  }
}


// ============================================================
// 合法手の判定と表示
// ============================================================

function clearLegalMoveMarkers() {
  const toRemove = [];
  scene.traverse(obj => {
    if (obj.userData && obj.userData.isLegalMoveMarker) {
      toRemove.push(obj);
    }
  });
  toRemove.forEach(obj => scene.remove(obj));
}

/** 人間の手番のときだけ、合法手を黄色い球で表示する */
function showAllLegalMoves() {
  clearLegalMoveMarkers();
  if (currentTurn === aiColor) return;

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        if (isLegalMove(board, x, y, z, currentTurn)) {
          showLegalMoveIndicator(x, y, z);
        }
      }
    }
  }
}

/**
 * (x, y, z) が currentTurn にとって合法手かを判定する。
 * 26方向のいずれかで「相手の石が1個以上連続し、その先に自分の石がある」なら合法。
 */
function isLegalMove(board, x, y, z, currentTurn) {
  if (board[x][y][z] !== null) {
    return false;
  }

  const opponent = currentTurn === 'black' ? 'white' : 'black';

  for (const [dx, dy, dz] of directions) {
    let nx = x + dx;
    let ny = y + dy;
    let nz = z + dz;
    let count = 0;

    while (
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      board[nx][ny][nz] === opponent
    ) {
      nx += dx;
      ny += dy;
      nz += dz;
      count++;
    }

    if (
      count > 0 &&
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      board[nx][ny][nz] === currentTurn
    ) {
      return true;
    }
  }

  return false;
}

function showLegalMoveIndicator(x, y, z) {
  const geometry = new THREE.SphereGeometry(stoneRadius * 0.6, 16, 16);
  const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
  const sphere = new THREE.Mesh(geometry, material);

  sphere.userData.isLegalMoveMarker = true;
  sphere.position.set(
    (x + 1.0) * spacing,
    (y + 1.0) * spacing,
    (z + 1.0) * spacing
  );

  sphere.name = 'legalMoveIndicator';
  scene.add(sphere);
}

function hasAnyLegalMove(player) {
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        if (isLegalMove(board, x, y, z, player)) return true;
      }
    }
  }
  return false;
}

function generateLegalMoves(color) {
  const legalMoves = [];

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        if (isLegalMove(board, x, y, z, color)) {
          legalMoves.push([x, y, z]);
        }
      }
    }
  }

  return legalMoves;
}


// ============================================================
// 石の反転
// ============================================================

/**
 * (x, y, z) に turnColor の石を置いたときの反転を、盤面データと3D表示の両方に反映する。
 * 手番の切り替え前に呼ぶこと。
 */
function flipStones(x, y, z, turnColor) {
  const opponent = turnColor === 'black' ? 'white' : 'black';
  let flipped = false;

  for (const [dx, dy, dz] of directions) {
    const stonesToFlip = [];

    let nx = x + dx;
    let ny = y + dy;
    let nz = z + dz;

    while (
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      board[nx][ny][nz] === opponent
    ) {
      stonesToFlip.push([nx, ny, nz]);
      nx += dx;
      ny += dy;
      nz += dz;
    }

    if (
      stonesToFlip.length > 0 &&
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      board[nx][ny][nz] === turnColor
    ) {
      for (const [fx, fy, fz] of stonesToFlip) {
        board[fx][fy][fz] = turnColor;
        removeStoneAt(fx, fy, fz);
        const color = turnColor === 'black' ? 0x000000 : 0xffffff;
        createStone(fx, fy, fz, color);
        flipped = true;
      }
    }
  }

  if (flipped) {
    updateStoneCountDisplay();
  }
}

/** 仮想盤で石を置き、反転する処理（実際の盤・3D表示には影響しない） */
function simulateMove(boardCopy, x, y, z, turnColor) {
  const opponent = turnColor === 'black' ? 'white' : 'black';
  boardCopy[x][y][z] = turnColor;

  for (const [dx, dy, dz] of directions) {
    const stonesToFlip = [];
    let nx = x + dx;
    let ny = y + dy;
    let nz = z + dz;

    while (
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      boardCopy[nx][ny][nz] === opponent
    ) {
      stonesToFlip.push([nx, ny, nz]);
      nx += dx; ny += dy; nz += dz;
    }

    if (
      stonesToFlip.length > 0 &&
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      boardCopy[nx][ny][nz] === turnColor
    ) {
      for (const [fx, fy, fz] of stonesToFlip) {
        boardCopy[fx][fy][fz] = turnColor;
      }
    }
  }
}


// ============================================================
// 石数の集計・表示
// ============================================================

function countStones() {
  let black = 0;
  let white = 0;
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        if (board[x][y][z] === 'black') black++;
        if (board[x][y][z] === 'white') white++;
      }
    }
  }
  return { black, white };
}

function updateStoneCountDisplay() {
  const count = countStones();
  const display = document.getElementById('stone-count-display');
  if (display) {
    display.textContent = `黒: ${count.black} ／ 白: ${count.white}`;
  }
}


// ============================================================
// パス処理（人間側）
// ============================================================

/**
 * パス通知のポップアップを表示する。
 * #pass-popup は CSS で `display: none !important` と指定されているため、
 * style.display ではなく、クラス 'visible' の付け外しで表示を切り替える。
 */
function showPassPopup() {
  if (!gameStarted) return;
  isPassPopupVisible = true;

  document.getElementById('pass-popup').classList.add('visible');

  // ポップアップ表示中は、通常の「1手戻す」ボタンを無効化する
  const undoBtn = document.getElementById('undo-button');
  if (undoBtn) undoBtn.disabled = true;
}

function hidePassPopup() {
  document.getElementById('pass-popup').classList.remove('visible');
  isPassPopupVisible = false;

  const undoBtn = document.getElementById('undo-button');
  if (undoBtn) undoBtn.disabled = false;
}

/** 人間の手番で置ける場所がなければ、パス通知または終局にする */
function PassorNot() {
  if (!gameStarted) return;
  if (currentTurn === aiColor) return;
  if (hasAnyLegalMove(currentTurn)) return;

  const otherPlayer = currentTurn === 'black' ? 'white' : 'black';
  if (!hasAnyLegalMove(otherPlayer)) {
    checkGameEnd();
  } else {
    showPassPopup();
  }
}

// 人間のパスを確定する（OKボタン）
document.getElementById('pass-ok-button').addEventListener('click', () => {
  hidePassPopup();

  // パスを棋譜に記録し、手番をAIへ
  moveHistory.push({ player: currentTurn, pass: true });
  currentTurn = currentTurn === 'black' ? 'white' : 'black';
  showAllLegalMoves();

  if (lastPlacedStone && lastPlacedColor) {
    const prevColor = lastPlacedColor === 'black' ? 0x000000 : 0xffffff;
    revertPreviousRedStone(prevColor);
  }

  // 両者とも置けない場合は終局
  if (!hasAnyLegalMove(aiColor)) {
    checkGameEnd();
    return;
  }

  handleAITurn();
});


// ============================================================
// 終局処理・棋譜の送信
// ============================================================

function checkGameEnd() {
  if (!gameStarted) return;

  const boardFull = placedStones.size >= size * size * size;
  const blackHasMove = hasAnyLegalMove('black');
  const whiteHasMove = hasAnyLegalMove('white');

  if (boardFull || (!blackHasMove && !whiteHasMove)) {
    const result = countStones();
    let winner = null;

    if (result.black > result.white) winner = 'black';
    else if (result.white > result.black) winner = 'white';
    else winner = 'draw';

    // 棋譜を保存用の形式に変換する（座標は1始まり）
    const formattedMoves = moveHistory.map((entry, i) => {
      if (entry.pass) {
        return { turn: i + 1, player: entry.player, pass: true };
      }
      const [x, y, z] = entry.move;
      return { turn: i + 1, player: entry.player, x: x + 1, y: y + 1, z: z + 1 };
    });

    const gameData = {
      first: firstPlayer,       // プレイヤー（人間）が選んだ色
      result: winner,           // 'black' / 'white' / 'draw'
      score: result,            // { black, white }
      moves: formattedMoves
    };

    gameStarted = false;
    aiRequestToken++;           // 進行中のAI応答を無効化
    hideAILoadingIndicator();
    hidePassPopup();
    showGameResultUI(gameData);
  }
}

function applyPopupStyle(element) {
  element.style.position = 'absolute';
  element.style.top = '30%';
  element.style.left = '50%';
  element.style.transform = 'translate(-50%, -50%)';
  element.style.backgroundColor = 'white';
  element.style.padding = '20px';
  element.style.borderRadius = '10px';
  element.style.textAlign = 'center';
  element.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.3)';
  element.style.zIndex = '100';
}

function showGameResultUI(result) {
  const container = document.createElement('div');
  container.id = 'game-result-ui';
  applyPopupStyle(container);

  const text = document.createElement('p');
  text.textContent = `勝者: ${result.result}（黒: ${result.score.black} - 白: ${result.score.white}）`;
  container.appendChild(text);

  // 棋譜送信ボタン
  const sendBtn = document.createElement('button');
  sendBtn.textContent = '棋譜を送信';
  sendBtn.style.margin = '10px';

  sendBtn.addEventListener('click', () => {
    const kifuRef = ref(database, "kifu");
    const newRef = push(kifuRef);
    set(newRef, result)
      .then(() => {
        alert('棋譜を送信しました！');
        container.remove();
        showNewGameButton();
      })
      .catch((error) => {
        console.error("送信エラー:", error);
        alert("棋譜の送信に失敗しました。");
      });
  });

  container.appendChild(sendBtn);
  document.body.appendChild(container);
}

function showNewGameButton() {
  const newGameContainer = document.createElement('div');
  newGameContainer.id = 'new-game-ui';
  applyPopupStyle(newGameContainer);

  const restartBtn = document.createElement('button');
  restartBtn.textContent = '新しいゲーム';
  restartBtn.addEventListener('click', () => {
    location.reload();
  });

  newGameContainer.appendChild(restartBtn);
  document.body.appendChild(newGameContainer);
}


// ============================================================
// AIの手番
// ============================================================

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function convertBoardForAI(board) {
  return board.map(layer =>
    layer.map(row =>
      row.map(cell => {
        if (cell === 'black') return 1;
        if (cell === 'white') return -1;
        return 0;
      })
    )
  );
}

async function fetchAIMove(board, player) {
  try {
    const convertedBoard = convertBoardForAI(board);
    const response = await fetch('https://othello-ai-server-501i.onrender.com/api/ai_move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        board: convertedBoard,
        player: player
      })
    });

    if (!response.ok) throw new Error(`status ${response.status}`);

    const data = await response.json();
    return data.move;
  } catch (error) {
    console.error('[fetchAIMove] エラー:', error);
    return null;
  }
}

/** サーバーから返った手が、現在の盤面でAIにとって合法かを確認する */
function isValidAIMove(m) {
  return Array.isArray(m) &&
    m.length === 3 &&
    m.every(v => Number.isInteger(v) && v >= 0 && v < size) &&
    isLegalMove(board, m[0], m[1], m[2], aiColor);
}

/**
 * AIの手番を処理する。
 * 非同期の途中で「1手戻す」や終局が起きた場合は、token が古くなるため処理を打ち切る。
 */
async function handleAITurn() {
  if (!gameStarted) return;
  if (currentTurn !== aiColor) return;

  const token = ++aiRequestToken;
  const isStale = () => token !== aiRequestToken || !gameStarted;

  showAILoadingIndicator();
  updateStoneCountDisplay();
  showAllLegalMoves();

  // UIが描画される余裕をつくる
  await sleep(0);
  if (isStale()) return;

  // ① 明らかに置けないなら即パス
  if (!hasAnyLegalMove(aiColor)) {
    performAIPass();
    return;
  }

  // ② サーバーに問い合わせる（失敗時は1回だけリトライ）
  let aiMove = await fetchAIMove(board, aiColor);
  if (isStale()) return;

  if (!isValidAIMove(aiMove)) {
    await sleep(200);
    if (isStale()) return;
    aiMove = await fetchAIMove(board, aiColor);
    if (isStale()) return;
  }

  // ③ それでも取得できなければ、ローカルの簡易AI（相手の合法手が最少になる手）で代替
  if (!isValidAIMove(aiMove)) {
    aicannot = true;
    aiMove = chooseMoveMinOpponentLegal();
  }

  if (aiMove) {
    performAIMoveAndContinue(aiMove);
  } else {
    performAIPass();
  }
}

/** AIの着手を盤面と3D表示に反映する */
function performAIMoveAndContinue(aiMove) {
  hideAILoadingIndicator();
  const [x, y, z] = aiMove;

  // 前回の赤い強調表示を元に戻す
  if (lastPlacedStone && lastPlacedColor) {
    const prevColor = lastPlacedColor === 'black' ? 0x000000 : 0xffffff;
    revertPreviousRedStone(prevColor);
  }

  const color = currentTurn === 'black' ? 0x000000 : 0xffffff;

  createStone(x, y, z, color, true);
  board[x][y][z] = currentTurn;
  placedStones.add(`${x},${y},${z}`);
  lastPlacedStone = [x, y, z];
  lastPlacedColor = currentTurn;

  moveHistory.push({ player: currentTurn, move: [x, y, z] });
  flipStones(x, y, z, currentTurn);
  updateStoneCountDisplay();

  currentTurn = currentTurn === 'black' ? 'white' : 'black';

  showAllLegalMoves();
  checkGameEnd();
  PassorNot(); // 人間に置ける場所がなければパス通知（終局済みなら何もしない）
}

/** AIのパスを処理する */
function performAIPass() {
  hideAILoadingIndicator();
  moveHistory.push({ player: aiColor, pass: true });

  if (lastPlacedStone && lastPlacedColor) {
    const prevColor = lastPlacedColor === 'black' ? 0x000000 : 0xffffff;
    revertPreviousRedStone(prevColor);
  }

  showAIPassPopup("AIはパスしました");
  currentTurn = aiColor === 'black' ? 'white' : 'black';
  updateStoneCountDisplay();
  showAllLegalMoves();
  checkGameEnd();
  PassorNot();
}

/**
 * currentTurn の色で合法手を評価し、相手の合法手が最も少なくなる手を返す。
 * 盤は変更せず、仮想盤でシミュレーションする。
 */
function chooseMoveMinOpponentLegal() {
  const legalMoves = generateLegalMoves(currentTurn);
  if (legalMoves.length === 0) return null;

  let bestMove = null;
  let minOpponentMoves = Infinity;

  for (const [x, y, z] of legalMoves) {
    const boardCopy = board.map(layer => layer.map(row => row.slice()));
    simulateMove(boardCopy, x, y, z, currentTurn);

    const opponent = currentTurn === 'black' ? 'white' : 'black';
    let opponentLegalCount = 0;
    for (let xi = 0; xi < 4; xi++) {
      for (let yi = 0; yi < 4; yi++) {
        for (let zi = 0; zi < 4; zi++) {
          if (isLegalMove(boardCopy, xi, yi, zi, opponent)) {
            opponentLegalCount++;
          }
        }
      }
    }

    if (opponentLegalCount < minOpponentMoves) {
      minOpponentMoves = opponentLegalCount;
      bestMove = [x, y, z];
    }
  }

  return bestMove;
}


// ============================================================
// AI関連のポップアップ・ローディング表示
// ============================================================

/** AIがパスしたことを一時的に通知する */
function showAIPassPopup(message) {
  const existingPopup = document.getElementById("ai-pass-popup");
  if (existingPopup) existingPopup.remove();

  const popup = document.createElement("div");
  popup.id = "ai-pass-popup";
  popup.textContent = message;
  popup.style.position = "fixed";
  popup.style.top = "50%";
  popup.style.left = "50%";
  popup.style.transform = "translate(-50%, -50%)";
  popup.style.background = "rgba(255, 80, 80, 0.9)";
  popup.style.color = "white";
  popup.style.padding = "20px 40px";
  popup.style.borderRadius = "12px";
  popup.style.fontSize = "20px";
  popup.style.fontWeight = "bold";
  popup.style.boxShadow = "0 0 15px rgba(0,0,0,0.3)";
  popup.style.zIndex = "9999";
  popup.style.opacity = "0";
  popup.style.transition = "opacity 0.3s ease";
  popup.style.pointerEvents = "none";

  document.body.appendChild(popup);

  requestAnimationFrame(() => {
    popup.style.opacity = "1";
  });

  // 1.5秒後に自動で消える
  setTimeout(() => {
    popup.style.opacity = "0";
    setTimeout(() => popup.remove(), 300);
  }, 1500);
}

/** AI思考中のローディング表示 */
function showAILoadingIndicator() {
  if (document.getElementById('ai-loading-indicator')) return;

  const loadingDiv = document.createElement('div');
  loadingDiv.id = 'ai-loading-indicator';
  loadingDiv.innerHTML = `
    <div class="spinner"></div>
    <p>AI思考中...</p>
  `;

  loadingDiv.style.position = 'fixed';
  loadingDiv.style.top = '50%';
  loadingDiv.style.left = '50%';
  loadingDiv.style.transform = 'translate(-50%, -50%)';
  loadingDiv.style.backgroundColor = 'rgba(255, 255, 255, 0.95)';
  loadingDiv.style.padding = '30px 50px';
  loadingDiv.style.borderRadius = '15px';
  loadingDiv.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.3)';
  loadingDiv.style.zIndex = '10000';
  loadingDiv.style.textAlign = 'center';
  loadingDiv.style.fontSize = '18px';
  loadingDiv.style.fontWeight = 'bold';
  loadingDiv.style.color = '#333';
  // 盤面の回転操作や、「1手戻す」ボタンの邪魔にならないようにする
  loadingDiv.style.pointerEvents = 'none';

  document.body.appendChild(loadingDiv);

  if (!document.getElementById('spinner-style')) {
    const style = document.createElement('style');
    style.id = 'spinner-style';
    style.textContent = `
      .spinner {
        width: 50px;
        height: 50px;
        border: 5px solid #f3f3f3;
        border-top: 5px solid #3498db;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 15px auto;
      }

      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
}

function hideAILoadingIndicator() {
  const loadingDiv = document.getElementById('ai-loading-indicator');
  if (loadingDiv) {
    loadingDiv.remove();
  }
}


// ============================================================
// 1手戻し機能
//
// 方針: 棋譜（moveHistory）の末尾から「人間の直前の1手」と「それ以降のAIの手」を削除し、
//       初期配置から棋譜を再生して盤面を作り直す。
//       戻した後は必ず人間の手番になる。
// ============================================================

/** 初期配置（黒4個・白4個）だけを置いた盤面データを返す */
function buildInitialBoard() {
  const b = [];
  for (let x = 0; x < size; x++) {
    b[x] = [];
    for (let y = 0; y < size; y++) {
      b[x][y] = new Array(size).fill(null);
    }
  }
  b[1][1][1] = 'black';
  b[2][2][1] = 'black';
  b[2][1][2] = 'black';
  b[1][2][2] = 'black';
  b[1][2][1] = 'white';
  b[2][2][2] = 'white';
  b[1][1][2] = 'white';
  b[2][1][1] = 'white';
  return b;
}

/** すべての石（と合法手マーカー）のメッシュをシーンから削除し、stoneMap を空にする */
function removeAllStones() {
  const toRemove = [];
  scene.traverse(obj => {
    if (obj instanceof THREE.Mesh && obj.geometry.type === "SphereGeometry") {
      toRemove.push(obj);
    }
  });
  toRemove.forEach(obj => scene.remove(obj));
  stoneMap.clear();
}

/** board の内容に合わせて、すべての石を描き直す（AIの直前の手だけ赤く強調する） */
function redrawAllStones() {
  removeAllStones();
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        const cell = board[x][y][z];
        if (cell !== null) {
          const color = cell === 'black' ? 0x000000 : 0xffffff;
          const isLast = lastPlacedStone &&
            lastPlacedColor === aiColor &&
            lastPlacedStone[0] === x &&
            lastPlacedStone[1] === y &&
            lastPlacedStone[2] === z;
          createStone(x, y, z, color, isLast);
        }
      }
    }
  }
}

/** 戻せる手があるか（人間の手が棋譜に1つ以上あるか） */
function canUndo() {
  if (!gameStarted) return false;
  return moveHistory.some(entry => entry.player !== aiColor);
}

/** 「1手戻す」ボタンから呼ばれる入口。対局中かつパス通知が出ていないときだけ実行する */
function undoLastMove() {
  if (!gameStarted) return;
  if (isPassPopupVisible) return;
  undoCore();
}

/** 1手戻しの本体処理。戻せたら true を返す */
function undoCore() {
  if (!canUndo()) return false;

  // 進行中のAI思考（サーバー応答待ち）を無効化し、関連表示を消す
  aiRequestToken++;
  hideAILoadingIndicator();
  const aiPassPopup = document.getElementById('ai-pass-popup');
  if (aiPassPopup) aiPassPopup.remove();

  // 末尾のAIの手（パス含む）をすべて削除し、続けて人間の直前の1手（パス含む）を削除する
  while (
    moveHistory.length > 0 &&
    moveHistory[moveHistory.length - 1].player === aiColor
  ) {
    moveHistory.pop();
  }
  moveHistory.pop();

  // 初期配置から棋譜を再生して、盤面を再構築する
  const rebuiltBoard = buildInitialBoard();
  for (const entry of moveHistory) {
    if (entry.pass) continue;
    const [mx, my, mz] = entry.move;
    simulateMove(rebuiltBoard, mx, my, mz, entry.player);
  }

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        board[x][y][z] = rebuiltBoard[x][y][z];
      }
    }
  }

  // 着手済みマスの集合を棋譜から作り直す
  placedStones.clear();
  for (const entry of moveHistory) {
    if (entry.pass) continue;
    placedStones.add(`${entry.move[0]},${entry.move[1]},${entry.move[2]}`);
  }

  // 「直前の着手」の情報を、残った棋譜の最後の着手に更新する
  const lastMoveEntry = [...moveHistory].reverse().find(e => !e.pass);
  if (lastMoveEntry) {
    lastPlacedStone = lastMoveEntry.move;
    lastPlacedColor = lastMoveEntry.player;
  } else {
    lastPlacedStone = null;
    lastPlacedColor = null;
  }

  // 戻した後は必ず人間の手番
  currentTurn = aiColor === 'black' ? 'white' : 'black';
  aicannot = false;

  // 3D表示・石数・合法手マーカーを更新する
  redrawAllStones();
  updateStoneCountDisplay();
  showAllLegalMoves();

  // 戻した先で人間に置ける場所がない場合は、パス通知を出す
  PassorNot();

  return true;
}
