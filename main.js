// main.js
import * as THREE from './libs/three.module.js';
import { OrbitControls } from './libs/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from './libs/CSS2DRenderer.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getDatabase, ref, push, set } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-database.js";

window.init = init;



let scene, camera, renderer, labelRenderer, controls;
let boardGroup;
let currentTurn = null; // 現在の手番（'black' または 'white'）
// グローバル変数に追加
let gameStarted = false;
// グローバル領域に追加（scene, camera, などと同じ場所）
let board = [];
const stoneRadius = 0.3;
let lastPlacedStone = null;
let lastPlacedColor = null;  // 最後に置かれた石の色（パスがあるため交互ではない可能性あり）

const stoneMap = new Map(); // キー = "x,y,z", 値 = stone Mesh
const moveHistory = []; // 各手の記録 ["2,3,1", "1,1,1", ...]
let firstPlayer = 'black';
let aiColor;
let aicannot = false;


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

const spacing = 1.2;
const size = 4;

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#ccffd0'); // 薄い水色の背景

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
  renderer.setClearColor('#ccffd0'); // 背景を薄い水色に設定（リロード時含む）
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
  const ambientLight = new THREE.AmbientLight(0xffffff, 5);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 10, 10);
  scene.add(directionalLight);

  const axesHelper = new THREE.AxesHelper(10); // 長さ10

scene.add(axesHelper);


for (let x = 0; x < size; x++) {
  board[x] = [];
  for (let y = 0; y < size; y++) {
    board[x][y] = [];
    for (let z = 0; z < size; z++) {
      board[x][y][z] = null; // 'black' or 'white' を後で格納する
    }
  }
}



  // ボード作成
boardGroup = new THREE.Group();
const geometry = new THREE.BoxGeometry(1, 1, 1);

// 透明なマテリアル（石を格納する空間）
const transparentMaterial = new THREE.MeshBasicMaterial({
  color: 0x000000,
  transparent: true,
  opacity: 0 // 完全に透明
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

      // 同じ位置に重ねて配置
      const boxGroup = new THREE.Group();
      boxGroup.add(cube);
      boxGroup.add(wireframe);

      // 位置調整（原点の正の方向に配置）
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


// 軸の長さ
const axisLength = 5;

// X軸（赤）
const xAxisMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
const xAxisGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(axisLength, 0, 0)
]);
const xAxis = new THREE.Line(xAxisGeometry, xAxisMaterial);
scene.add(xAxis);

// Y軸（緑）
const yAxisMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
const yAxisGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, axisLength, 0)
]);
const yAxis = new THREE.Line(yAxisGeometry, yAxisMaterial);
scene.add(yAxis);

// Z軸（青）
const zAxisMaterial = new THREE.LineBasicMaterial({ color: 0x0000ff });
const zAxisGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 0, axisLength)
]);
const zAxis = new THREE.Line(zAxisGeometry, zAxisMaterial);
scene.add(zAxis);



  // 軸ラベル追加
  createAxisLabel('X', (4 + 0.5) * spacing, 0, 0);
createAxisLabel('Y', 0, (4 + 0.5) * spacing, 0);
createAxisLabel('Z', 0, 0, (4 + 0.5) * spacing);

updateStoneCountDisplay(); // ← 初期配置反映
  animate();
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

document.addEventListener('DOMContentLoaded', () => {
  const turnUI = document.getElementById('turn-selection');
  const blackButton = document.getElementById('black-button');
  const whiteButton = document.getElementById('white-button');

  if (blackButton && whiteButton && turnUI) {
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
      console.log("✅ 白選択: AIカラー=", aiColor, " 現在の手番=", currentTurn);

      if (currentTurn === aiColor) {
        console.log("✅ AI先手なので handleAITurn 呼び出し");
        handleAITurn();
      }
    });
  } else {
    console.error("❌ ボタンやUIが見つかりません");
  }
});


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

  const key = `${x},${y},${z}`;
  stoneMap.set(key, stone); // 管理用マップに記録
}

function revertPreviousRedStone(color) {
  if (!lastPlacedStone) return;

  const [x, y, z] = lastPlacedStone;
  const key = `${x},${y},${z}`;
  const mesh = stoneMap.get(key);
  if (mesh) {
    mesh.material.color.set(color);
  }
}

function setupPointerListener() {
  window.addEventListener('pointerdown', handlePointerDownOnce);
}

function handlePointerDownOnce(event) {
  if (!gameStarted || !firstPlayer) return;

  if (currentTurn === aiColor) return;


  const mouse = new THREE.Vector2();
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(boardGroup.children, true);
  if (intersects.length > 0) {
    const intersect = intersects[0];
    const point = intersect.object.parent.position;

    const x = Math.round(point.x / spacing) - 1;
    const y = Math.round(point.y / spacing) - 1;
    const z = Math.round(point.z / spacing) - 1;

    const key = `${x},${y},${z}`;
    if (placedStones.has(key)) return;
    if (!isLegalMove(board, x, y, z, currentTurn)) return;

    // 石を置く前に、前の赤い石を元の色に戻す
    if (lastPlacedStone) {
      const [lx, ly, lz] = lastPlacedStone;
      const prevColor = lastPlacedColor === 'black' ? 0x000000 : 0xffffff;
      revertPreviousRedStone(prevColor);
    }

    const color = currentTurn === 'black' ? 0x000000 : 0xffffff;
    createStone(x, y, z, color, false);

    board[x][y][z] = currentTurn;
    placedStones.add(key);

    moveHistory.push({ player: currentTurn, move: [x, y, z] });

    lastPlacedStone = [x, y, z];
    lastPlacedColor = currentTurn; // ←これを必ず追加！

    flipStones(x, y, z, currentTurn);
    currentTurn = currentTurn === 'black' ? 'white' : 'black';

    updateStoneCountDisplay();
    showAllLegalMoves();
    
        if (currentTurn !== aiColor) {
    const otherPlayer = currentTurn === 'black' ? 'white' : 'black';
    console.log(currentTurn, aiColor, hasAnyLegalMove(currentTurn), hasAnyLegalMove(aiColor), hasAnyLegalMove(otherPlayer),aicannot);
    
    if (!hasAnyLegalMove(currentTurn) && gameStarted === true) {
        if (!hasAnyLegalMove(otherPlayer) ) {
            checkGameEnd();
        } else {
            showPassPopup();
        }
    }}

    if (currentTurn === aiColor) {
      handleAITurn();
    }
  }
}



function clearLegalMoveMarkers() {
  const toRemove = [];
  scene.traverse(obj => {
    if (obj.userData && obj.userData.isLegalMoveMarker) {
      toRemove.push(obj);
    }
  });
  toRemove.forEach(obj => scene.remove(obj));
}


function showAllLegalMoves() {
  clearLegalMoveMarkers();
  if (currentTurn === aiColor) return;

  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      for (let z = 0; z < 4; z++) {
        const legal = isLegalMove(board, x, y, z, currentTurn);
        if (legal) {
          showLegalMoveIndicator(x, y, z);
        } 
        }
      }
    }
  }
const placedStones = new Set();

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

function isLegalMove(board, x, y, z, currentTurn) {
  if (board[x][y][z] !== null) {
    return false;
  }

  const opponent = currentTurn === 'black' ? 'white' : 'black';
  let legal = false;

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
      legal = true;
      break;
    }
  }


  return legal;
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


function removeStoneAt(x, y, z) {
  const targetPosition = new THREE.Vector3(
    (x + 1.0) * spacing,
    (y + 1.0) * spacing,
    (z + 1.0) * spacing
  );

  const toRemove = scene.children.find(obj =>
    obj instanceof THREE.Mesh &&
    obj.geometry.type === "SphereGeometry" &&
    obj.position.distanceTo(targetPosition) < 0.01 // 少し誤差許容
  );

  if (toRemove) {
    scene.remove(toRemove);
  }
}

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

function showGameResultUI(result) {
  // UIを作成
  const container = document.createElement('div');
  container.id = 'game-result-ui';
  container.style.position = 'absolute';
  container.style.top = '30%';
  container.style.left = '50%';
  container.style.transform = 'translate(-50%, -50%)';
  container.style.backgroundColor = 'white';
  container.style.padding = '20px';
  container.style.borderRadius = '10px';
  container.style.textAlign = 'center';
  container.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.3)';
  container.style.zIndex = '100';

  const text = document.createElement('p');
  text.textContent = `勝者: ${result.result}（黒: ${result.score.black} - 白: ${result.score.white}）`;
  container.appendChild(text);

  // 棋譜送信ボタン
const sendBtn = document.createElement('button');
sendBtn.textContent = '棋譜を送信';
sendBtn.style.margin = '10px';

sendBtn.addEventListener('click', () => {
  const kifuRef = ref(database, "kifu"); // "kifu" ノードに保存
  const newRef = push(kifuRef); // ユニークキーを自動生成
  set(newRef, result) // result は棋譜オブジェクト
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

  // 全体をbodyに追加
  document.body.appendChild(container);
}

function showNewGameButton() {
  const newGameContainer = document.createElement('div');
  newGameContainer.id = 'new-game-ui';
  newGameContainer.style.position = 'absolute';
  newGameContainer.style.top = '30%';
  newGameContainer.style.left = '50%';
  newGameContainer.style.transform = 'translate(-50%, -50%)';
  newGameContainer.style.backgroundColor = 'white';
  newGameContainer.style.padding = '20px';
  newGameContainer.style.borderRadius = '10px';
  newGameContainer.style.textAlign = 'center';
  newGameContainer.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.3)';
  newGameContainer.style.zIndex = '100';

  const restartBtn = document.createElement('button');
  restartBtn.textContent = '新しいゲーム';
  restartBtn.addEventListener('click', () => {
    location.reload(); // または任意の初期化処理
  });

  newGameContainer.appendChild(restartBtn);
  document.body.appendChild(newGameContainer);
}



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

    const formattedMoves = moveHistory.map((entry, i) => {
      if (entry.pass) {
        return {
          turn: i + 1,
          player: entry.player,
          pass: true
        };
      } else {
        const [x, y, z] = entry.move;
        return {
          turn: i + 1,
          player: entry.player,
          x: x + 1, // 1-indexed に変換
          y: y + 1,
          z: z + 1
        };
      }
    });

    // 最終的に送信する棋譜データ
    const gameData = {
      first: firstPlayer,       // 'black' または 'white'
      result: winner,           // 'black' / 'white' / 'draw'
      score: result,            // { black: 〜, white: 〜 }
      moves: formattedMoves     // 各手の履歴（1-indexed）
    };

    console.log('🎯 ゲーム終了:', gameData);
    gameStarted = false;
    showGameResultUI(gameData); // UIに表示 or サーバに送信
  }
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

function showPassPopup() {
  const passPopup = document.getElementById('pass-popup');
  const turnUI = document.getElementById('turn-selection');

  // ✅ デバッグ出力
  console.log('🟡 showPassPopup called');
  console.log('🔸 gameStarted:', gameStarted);
  console.log('🔸 firstPlayer:', firstPlayer);
  console.log('🔸 turnUI.style.display:', turnUI ? turnUI.style.display : 'null');

  // ✅ ゲームが開始していないなら表示しない
  if (gameStarted === false) {
    console.log('⛔ gameStarted is false → パスポップアップ非表示');
    return;
  }

  // ✅ プレイヤーが未選択なら表示しない
  if (!firstPlayer) {
    console.log('⛔ firstPlayer is falsy → パスポップアップ非表示');
    return;
  }

  // ✅ 手番選択UIがまだ表示中なら表示しない
  if (turnUI && turnUI.style.display !== 'none') {
    console.log('⛔ 手番選択UIが表示中 → パスポップアップ非表示');
    return;
  }

  // ✅ すべての条件を通過した場合のみ表示
  console.log('✅ 全ての条件OK → パスポップアップを表示');
  passPopup.style.display = 'block';
}


function hidePassPopup() {
  document.getElementById('pass-popup').style.display = 'none';
}

document.getElementById('pass-ok-button').addEventListener('click', () => {
  hidePassPopup();
  moveHistory.push({ player: currentTurn, pass: true });

  currentTurn = currentTurn === 'black' ? 'white' : 'black';
  showAllLegalMoves();

  if (lastPlacedStone) {
    const prevColor = aiColor === 'black' ? 0x000000 : 0xffffff;
    revertPreviousRedStone(prevColor);
  }

  // ✅ AIが動くべきならここで判断（新方式）
handleAITurn(); // ← これだけ残す！

  // 再度合法手がなければゲーム終了
  if (!hasAnyLegalMove(currentTurn)) {
    checkGameEnd();
  }
});

function updateStoneCountDisplay() {
  const count = countStones();
  const display = document.getElementById('stone-count-display');
  if (display) {
    display.textContent = `黒: ${count.black} ／ 白: ${count.white}`;
  }
}

async function fetchAIMove(board, player) {
  console.log("🌐 fetchAIMove() 呼び出し: aiColor=", aiColor);
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
    console.log('[AI応答詳細]', JSON.stringify(data, null, 2));
    console.log('[AI応答]', data);
    return data.move;
  } catch (error) {
    console.error('[fetchAIMove] エラー:', error);
    return null;
  }
}

// --- AI専用のパス通知ポップアップ ---
function showAIPassPopup(message) {
  // すでに同種のポップアップが存在する場合は削除
  const existingPopup = document.getElementById("ai-pass-popup");
  if (existingPopup) existingPopup.remove();

  // ポップアップ要素を作成
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

  document.body.appendChild(popup);

  // 表示アニメーション
  requestAnimationFrame(() => {
    popup.style.opacity = "1";
  });

  // 1.5秒後に自動で消える
  setTimeout(() => {
    popup.style.opacity = "0";
    setTimeout(() => popup.remove(), 300);
  }, 1500);
}




async function handleAITurn() {
  if (currentTurn !== aiColor) {
    console.log("❌ handleAITurn: 呼び出されたが currentTurn ≠ aiColor");
    return;
  }

  console.log("🧠 AIターン開始: currentTurn =", currentTurn);

showAILoadingIndicator();
  
  // 盤情報を最新化（ビュー側も更新）
  updateStoneCountDisplay();
  showAllLegalMoves();

  // 少しだけ遅らせて非同期スコープで処理（UIが描画される余裕をつくる）
  setTimeout(async () => {
    // ① まず軽量チェック：明らかに置けないなら即パス処理
    if (!hasAnyLegalMove(aiColor)) {
      console.log("🧾 hasAnyLegalMove => false: AIは確実に置けない");
      // パス処理
      hideAILoadingIndicator();
      moveHistory.push({ player: aiColor, pass: true });
      // 前回赤膜の復元（lastPlacedColor を使うことを推奨）
      if (lastPlacedStone && lastPlacedColor) {
        const prevColor = lastPlacedColor === 'black' ? 0x000000 : 0xffffff;
        revertPreviousRedStone(prevColor);
      }

      showAIPassPopup("AIはパスしました");
      currentTurn = aiColor === 'black' ? 'white' : 'black';
      updateStoneCountDisplay();
      showAllLegalMoves();
      if (checkGameEnd()) return;
      // 次がAIなら再帰（遅延）
      if (currentTurn === aiColor) setTimeout(() => handleAITurn(), 800);
      return;
    }

    // ② hasAnyLegalMove が true の場合、fetchAIMove に頼る
    let aiMove = null;
    try {
      aiMove = await fetchAIMove(board, aiColor);
    } catch (err) {
      console.error("fetchAIMove が例外を投げました:", err);
      aiMove = null;
    }
    console.log("🤖 fetchAIMove の戻り =", aiMove);

    // ③ fetchAIMove が null の場合はフォールバック・再確認を行う
    if (aiMove == null) {
      console.warn("⚠️ fetchAIMove が null を返したため、フォールバックで合法手を再確認します");

      // フォールバック：自前で合法手リストを作る（generateLegalMoves は盤全探索して合法を返す関数）
      const fallbackMoves = generateLegalMoves(aiColor); // 例: [{x,y,z}, ...] を返すこと
      console.log("🧩 フォールバックで検出した合法手数 =", fallbackMoves.length);

      if (fallbackMoves.length === 0) {
        // 本当に置けない（fetchAIMove と整合）
        console.log("🚫 フォールバックでも合法手なし：AIパス確定");
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
        if (checkGameEnd()) return;
        if (currentTurn === aiColor) setTimeout(() => handleAITurn(), 800);
        return;
      } else {
        // フォールバックで合法手があるが fetchAIMove が null: AI側の一時エラーの可能性
        console.warn("⚠️ fetchAIMove が null だがフォールバックでは手が存在 -> 1回だけリトライします");
        // 1回だけ短い遅延で再試行
        setTimeout(async () => {
          let retryMove = null;
          try {
            retryMove = await fetchAIMove(board, aiColor);
          } catch (err) {
            console.error("fetchAIMove retry で例外:", err);
            retryMove = null;
          }
          console.log("🔁 retry fetchAIMove の戻り =", retryMove);
          if (retryMove == null) {
            // 安全側：今回はパス扱い（無限ループ阻止のため）
            console.error("❌ retryでも取得できず：安全のため今回AIはパス扱いにします");
            aicannot = true;

            if (aicannot === true){
              let aiMove = chooseMoveMinOpponentLegal();
            if (aiMove) {
             hideAILoadingIndicator();
              performAIMoveAndContinue(aiMove);
            }
              else {
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
                PassorNot();
                if (checkGameEnd()) return;
                if (currentTurn === aiColor) setTimeout(() => handleAITurn(), 800);
                return;
              }
              console.log("aaaa")
              PassorNot();
            }
          } else {
            // リトライ成功 -> 通常の着手処理へ
           hideAILoadingIndicator();
            performAIMoveAndContinue(retryMove);
            return;
          }
        }, 200); // 200ms の短い待ち
        return; // リトライブロックに処理を移す
      }
    }

    // ④ aiMove が存在する（通常ケース）なら着手処理
   hideAILoadingIndicator();
    performAIMoveAndContinue(aiMove);

    PassorNot();

  }, 0);
  
}

// 着手処理を分離すると見通しが良い
function performAIMoveAndContinue(aiMove) {
  hideAILoadingIndicator();
  const [x, y, z] = aiMove;
  const color = currentTurn === 'black' ? 0x000000 : 0xffffff;
  
  createStone(x, y, z, color, true);
  board[x][y][z] = currentTurn;
  placedStones.add(`${x},${y},${z}`);
  lastPlacedStone = [x, y, z];
  lastPlacedColor = currentTurn;
  console.log(currentTurn);
  console.log(lastPlacedColor);

  moveHistory.push({ player: currentTurn, move: [x, y, z] });
  flipStones(x, y, z, currentTurn);
  updateStoneCountDisplay();

  currentTurn = currentTurn === 'black' ? 'white' : 'black';
  
  showAllLegalMoves();
  if (checkGameEnd()) return;

  if (currentTurn === aiColor) {
    setTimeout(() => handleAITurn(), 800);
  }
}

function generateLegalMoves(color) {
  const legalMoves = [];

  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      for (let z = 0; z < 4; z++) {
        if (isLegalMove(board, x, y, z, color)) {
          legalMoves.push([x, y, z]);
        }
      }
    }
  }

  return legalMoves;
}


function convertBoardForAI(board) {
  return board.map(layer =>
    layer.map(row =>
      row.map(cell => {
        if (cell === 'black') return 1;
        if (cell === 'white') return -1;
        return 0; // 'empty' または null または undefined
      })
    )
  );
}

function PassorNot() {
  if (currentTurn !== aiColor) {
    const otherPlayer = currentTurn === 'black' ? 'white' : 'black';
    console.log(
      "currentTurn=",currentTurn,
       "aiColor=", aiColor,
       "hasAnyLegalMove(currentTurn)", hasAnyLegalMove(currentTurn),
       "hasAnyLegalMove(aiColor)", hasAnyLegalMove(aiColor), 
       "hasAnyLegalMove(othePlayer)", hasAnyLegalMove(otherPlayer),
       "aicannot=",aicannot,
       "gameStarted=",gameStarted);
    
    if (hasAnyLegalMove(currentTurn) === false && gameStarted === true) {
        if (hasAnyLegalMove(otherPlayer) === false) {
          console.log("checkgameend中");
            checkGameEnd();
        } else {
          console.log("showpasspopup中");
            showPassPopup();
        }
    }
  }
}  



/**
 * currentTurn の色で合法手を評価し、
 * 相手の合法手が最も少なくなる手を返す
 * 盤は変更せず、仮想盤でシミュレーション
 */
function chooseMoveMinOpponentLegal() {
  // ① 現在の手番の合法手を取得
  const legalMoves = generateLegalMoves(currentTurn);
  if (legalMoves.length === 0) return null; // 合法手なしなら null

  let bestMove = null;
  let minOpponentMoves = Infinity;

  // ② 各合法手についてシミュレーション
  for (const [x, y, z] of legalMoves) {
    // 仮想盤の作成（deep copy）
    const boardCopy = board.map(layer => layer.map(row => row.slice()));

    // 仮に置いて flip
    simulateMove(boardCopy, x, y, z, currentTurn);

    // ③ 相手色の合法手数を数える
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

    // ④ 相手の合法手が最小のものを更新
    if (opponentLegalCount < minOpponentMoves) {
      minOpponentMoves = opponentLegalCount;
      bestMove = [x, y, z];
    }
  }

  return bestMove; // [x, y, z] または null
}

/**
 * 仮想盤で石を置き、flipする処理
 * 実際の盤には影響なし
 */
// ========================================
// AI思考中ローディング表示の制御関数
// ========================================
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
      // flip
      for (const [fx, fy, fz] of stonesToFlip) {
        boardCopy[fx][fy][fz] = turnColor;
      }
    }
  }
}
