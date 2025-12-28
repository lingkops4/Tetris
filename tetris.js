// Cyber Blue Tetris
// 簡潔但完整的俄羅斯方塊實作，使用 canvas 繪製並有 next/hold、等級、分數、硬降等功能

(() => {
  // constants
  const COLS = 10;
  const ROWS = 20;
  const BLOCK = 30; // pixel per cell on main board (canvas 300x600)
  const COLORS = {
    I: '#39f0ff',
    J: '#2b9dff',
    L: '#3bb7ff',
    O: '#7fe6ff',
    S: '#17d5ff',
    T: '#5ad8ff',
    Z: '#1ac7ff'
  };

  const SHAPES = {
    I: [[1,1,1,1]],
    J: [[1,0,0],[1,1,1]],
    L: [[0,0,1],[1,1,1]],
    O: [[1,1],[1,1]],
    S: [[0,1,1],[1,1,0]],
    T: [[0,1,0],[1,1,1]],
    Z: [[1,1,0],[0,1,1]]
  };

  // canvas elements
  const boardCanvas = document.getElementById('board');
  const bCtx = boardCanvas.getContext('2d');
  const nextCanvas = document.getElementById('next'); const nCtx = nextCanvas.getContext('2d');
  const holdCanvas = document.getElementById('hold'); const hCtx = holdCanvas.getContext('2d');

  // UI
  const scoreEl = document.getElementById('score');
  const levelEl = document.getElementById('level');
  const linesEl = document.getElementById('lines');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const restartBtn = document.getElementById('restartBtn');

  // state
  let grid, current, nextQueue, holdPiece, canHold;
  let score = 0, level = 1, lines = 0;
  let dropInterval = 1000; // ms per step, will speed up with level
  let lastDrop = 0;
  let running = false;
  let gameOver = false;
  let animationId = null;

  // Utility
  function cloneMatrix(m){ return m.map(r => r.slice()); }
  function rotate(matrix, dir=1){
    // transpose + reverse rows/cols. dir=1 cw, -1 ccw
    const N = matrix.length;
    const res = Array.from({length: N}, ()=>Array(N).fill(0));
    for(let r=0;r<N;r++) for(let c=0;c<N;c++){
      if(dir===1) res[c][N-1-r] = matrix[r][c];
      else res[N-1-c][r] = matrix[r][c];
    }
    return res;
  }
  function makeEmptyGrid(){ return Array.from({length: ROWS}, ()=>Array(COLS).fill(0)); }

  // Piece generator (7-bag)
  function* bagGenerator(){
    while(true){
      const pieces = Object.keys(SHAPES).slice();
      for(let i=pieces.length-1;i>0;i--){
        const j = Math.floor(Math.random()*(i+1));
        [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
      }
      for(const p of pieces) yield p;
    }
  }
  const bag = bagGenerator();

  function spawnPiece(){
    const type = nextQueue.shift() || bag.next().value;
    // ensure queue length >= 5
    while(nextQueue.length < 5) nextQueue.push(bag.next().value);
    const shape = SHAPES[type];
    // convert shape to square matrix for easier rotation
    const size = Math.max(shape.length, shape[0].length);
    const matrix = Array.from({length:size}, ()=>Array(size).fill(0));
    for(let r=0;r<shape.length;r++) for(let c=0;c<shape[r].length;c++) if(shape[r][c]) matrix[r][c] = type;
    const x = Math.floor((COLS - size)/2);
    const y = -size + 1; // start above board slightly
    return {type, matrix, x, y, size};
  }

  function collide(grid, piece, offsetX=0, offsetY=0){
    const {matrix, x, y} = piece;
    for(let r=0;r<matrix.length;r++) for(let c=0;c<matrix[r].length;c++){
      if(!matrix[r][c]) continue;
      const gx = x + c + offsetX;
      const gy = y + r + offsetY;
      if(gx < 0 || gx >= COLS) return true;
      if(gy >= ROWS) return true;
      if(gy >= 0 && grid[gy][gx]) return true;
    }
    return false;
  }

  function merge(grid, piece){
    const {matrix, x, y} = piece;
    for(let r=0;r<matrix.length;r++) for(let c=0;c<matrix[r].length;c++){
      if(!matrix[r][c]) continue;
      const gx = x + c;
      const gy = y + r;
      if(gy>=0 && gy<ROWS && gx>=0 && gx<COLS) grid[gy][gx] = piece.type;
    }
  }

  function clearLines(){
    let cleared = 0;
    for(let r=ROWS-1;r>=0;r--){
      if(grid[r].every(cell=>cell!==0)){
        grid.splice(r,1);
        grid.unshift(Array(COLS).fill(0));
        cleared++;
        r++; // re-evaluate same row index
      }
    }
    if(cleared>0){
      lines += cleared;
      score += (cleared === 1 ? 100 : cleared === 2 ? 300 : cleared === 3 ? 500 : 800) * level;
      level = Math.floor(lines / 10) + 1;
      dropInterval = Math.max(80, 1000 - (level-1)*70);
    }
  }

  // drawing helpers
  function drawCell(ctx, x, y, size, color, outline=true, glow=true){
    ctx.save();
    if(glow){
      ctx.shadowBlur = 18;
      ctx.shadowColor = color;
    }
    ctx.fillStyle = color;
    roundRect(ctx, x+1, y+1, size-2, size-2, 6);
    ctx.fill();
    if(outline){
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.stroke();
    }
    // inner glossy highlight
    const grad = ctx.createLinearGradient(x, y, x+size, y+size);
    grad.addColorStop(0, 'rgba(255,255,255,0.06)');
    grad.addColorStop(1, 'rgba(255,255,255,0.00)');
    ctx.fillStyle = grad;
    ctx.globalCompositeOperation = 'overlay';
    roundRect(ctx, x+1, y+1, size-2, size/2, 6);
    ctx.fill();
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
  }

  function drawGrid(){
    bCtx.clearRect(0,0, boardCanvas.width, boardCanvas.height);
    // background grid lines subtle
    bCtx.save();
    bCtx.fillStyle = 'rgba(2,10,20,0.35)';
    roundRect(bCtx, 0, 0, COLS*BLOCK, ROWS*BLOCK, 6);
    bCtx.fill();
    bCtx.restore();

    // draw placed blocks
    for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
      const cell = grid[r][c];
      if(cell){
        const color = COLORS[cell] || '#2bd1ff';
        bCtx.save();
        bCtx.translate(c*BLOCK, r*BLOCK);
        drawCell(bCtx, 0, 0, BLOCK, color);
        bCtx.restore();
      }
    }

    // draw current piece
    if(current){
      const {matrix, x, y, type} = current;
      for(let r=0;r<matrix.length;r++) for(let c=0;c<matrix[r].length;c++){
        if(matrix[r][c]){
          const gx = x + c;
          const gy = y + r;
          if(gy >= 0){
            const color = COLORS[type];
            bCtx.save();
            bCtx.translate(gx*BLOCK, gy*BLOCK);
            drawCell(bCtx, 0, 0, BLOCK, color);
            bCtx.restore();
          } else {
            // preview for above-board cells (draw faint)
            const color = COLORS[type];
            bCtx.save();
            bCtx.globalAlpha = 0.45;
            bCtx.translate(gx*BLOCK, 0);
            drawCell(bCtx, 0, 0, BLOCK, color);
            bCtx.restore();
          }
        }
      }
    }

    // grid lines
    bCtx.save();
    bCtx.strokeStyle = 'rgba(255,255,255,0.03)';
    bCtx.lineWidth = 1;
    for(let i=0;i<=COLS;i++){
      bCtx.beginPath();
      bCtx.moveTo(i*BLOCK,0);
      bCtx.lineTo(i*BLOCK,ROWS*BLOCK);
      bCtx.stroke();
    }
    for(let i=0;i<=ROWS;i++){
      bCtx.beginPath();
      bCtx.moveTo(0,i*BLOCK);
      bCtx.lineTo(COLS*BLOCK,i*BLOCK);
      bCtx.stroke();
    }
    bCtx.restore();
  }

  function drawMini(ctx, piece, cellSize=28){
    ctx.clearRect(0,0, ctx.canvas.width, ctx.canvas.height);
    ctx.save();
    ctx.fillStyle = 'transparent';
    ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);
    ctx.restore();
    if(!piece) return;
    const size = piece.matrix.length;
    const totalW = size*cellSize;
    const offX = Math.floor((ctx.canvas.width - totalW)/2);
    const offY = Math.floor((ctx.canvas.height - totalW)/2);
    for(let r=0;r<size;r++) for(let c=0;c<size;c++){
      if(piece.matrix[r][c]){
        const color = COLORS[piece.type];
        drawCell(ctx, offX + c*cellSize, offY + r*cellSize, cellSize-2, color);
      }
    }
  }

  // game actions
  function hardDrop(){
    if(!current) return;
    while(!collide(grid, current, 0, 1)){
      current.y += 1;
      score += 2;
    }
    lockPiece();
  }

  function softDrop(){
    if(!current) return;
    if(!collide(grid, current, 0, 1)){
      current.y += 1;
      score += 1;
    } else {
      lockPiece();
    }
  }

  function move(dir){
    if(!current) return;
    if(!collide(grid, current, dir, 0)) current.x += dir;
  }

  function rotatePiece(dir=1){
    if(!current) return;
    const newMatrix = rotate(current.matrix, dir);
    const oldX = current.x;
    // attempt wall kicks (basic: try shifts -1, +1, -2, +2)
    const kicks = [0, -1, 1, -2, 2];
    for(const k of kicks){
      const test = {...current, matrix:newMatrix, x: oldX + k};
      if(!collide(grid, test, 0, 0)){
        current.matrix = newMatrix;
        current.x = oldX + k;
        return;
      }
    }
  }

  function lockPiece(){
    merge(grid, current);
    clearLines();
    updateUI();
    current = spawnPiece();
    canHold = true;
    if(collide(grid, current, 0, 0)){
      // game over
      running = false;
      gameOver = true;
      cancelAnimationFrame(animationId);
      showGameOver();
    }
  }

  function hold(){
    if(!current || !canHold) return;
    if(!holdPiece){
      holdPiece = {type: current.type, matrix: cloneMatrix(current.matrix), size: current.size};
      current = spawnPiece();
    } else {
      const tmp = {type: holdPiece.type, matrix: cloneMatrix(holdPiece.matrix), size: holdPiece.size};
      holdPiece = {type: current.type, matrix: cloneMatrix(current.matrix), size: current.size};
      // spawn tmp as current but center x
      current = tmp;
      current.x = Math.floor((COLS - current.matrix.length)/2);
      current.y = -current.matrix.length + 1;
      if(collide(grid, current)) {
        running = false; gameOver = true; cancelAnimationFrame(animationId); showGameOver();
      }
    }
    canHold = false;
    drawMini(hCtx, holdPiece);
  }

  function showGameOver(){
    bCtx.save();
    bCtx.fillStyle = 'rgba(2,6,12,0.8)';
    roundRect(bCtx, 10, 200, COLS*BLOCK - 20, 160, 10);
    bCtx.fill();
    bCtx.fillStyle = '#cfeefd';
    bCtx.font = '28px Inter, Arial';
    bCtx.textAlign = 'center';
    bCtx.fillText('GAME OVER', (COLS*BLOCK)/2, 270);
    bCtx.font = '16px Inter, Arial';
    bCtx.fillText(`Score: ${score}`, (COLS*BLOCK)/2, 305);
    bCtx.restore();
  }

  function updateUI(){
    scoreEl.textContent = score;
    levelEl.textContent = level;
    linesEl.textContent = lines;
    drawMini(nCtx, {type: nextQueue[0], matrix: (() => {
      const shape = SHAPES[nextQueue[0]];
      const size = Math.max(shape.length, shape[0].length);
      const matrix = Array.from({length:size}, ()=>Array(size).fill(0));
      for(let r=0;r<shape.length;r++) for(let c=0;c<shape[r].length;c++) if(shape[r][c]) matrix[r][c] = nextQueue[0];
      return matrix;
    })()});
    drawMini(hCtx, holdPiece);
  }

  // main loop
  function update(time=0){
    if(!running) return;
    if(!lastDrop) lastDrop = time;
    const delta = time - lastDrop;
    if(delta > dropInterval){
      if(!collide(grid, current, 0, 1)){
        current.y += 1;
      } else {
        lockPiece();
      }
      lastDrop = time;
    }
    drawGrid();
    animationId = requestAnimationFrame(update);
  }

  // initialization
  function init(){
    grid = makeEmptyGrid();
    nextQueue = [];
    for(let i=0;i<6;i++) nextQueue.push(bag.next().value);
    current = spawnPiece();
    holdPiece = null;
    canHold = true;
    score = 0; level = 1; lines = 0;
    dropInterval = 1000;
    lastDrop = 0;
    running = false;
    gameOver = false;
    updateUI();
    drawGrid();
    drawMini(nCtx, {type: nextQueue[0], matrix: (() => {
      const shape = SHAPES[nextQueue[0]];
      const size = Math.max(shape.length, shape[0].length);
      const matrix = Array.from({length:size}, ()=>Array(size).fill(0));
      for(let r=0;r<shape.length;r++) for(let c=0;c<shape[r].length;c++) if(shape[r][c]) matrix[r][c] = nextQueue[0];
      return matrix;
    })()});
    drawMini(hCtx, holdPiece);
  }

  // keyboard
  const keys = {};
  window.addEventListener('keydown', (e)=>{
    if(e.repeat) return;
    const key = e.key.toLowerCase();
    if(key === 'arrowleft'){ move(-1); drawGrid(); }
    else if(key === 'arrowright'){ move(1); drawGrid(); }
    else if(key === 'arrowdown'){ softDrop(); drawGrid(); }
    else if(key === ' '){ e.preventDefault(); hardDrop(); drawGrid(); }
    else if(key === 'x' || e.key === 'ArrowUp'){ rotatePiece(1); drawGrid(); }
    else if(key === 'z'){ rotatePiece(-1); drawGrid(); }
    else if(key === 'shift' || key === 'c'){ hold(); updateUI(); drawGrid(); }
    else if(key === 'r'){ init(); start(); }
  });

  // mouse / buttons
  startBtn.addEventListener('click', ()=>{ start(); });
  pauseBtn.addEventListener('click', ()=>{ pause(); });
  restartBtn.addEventListener('click', ()=>{ init(); start(); });

  function start(){
    if(gameOver) { init(); }
    if(!running){
      running = true;
      lastDrop = 0;
      animationId = requestAnimationFrame(update);
    }
  }
  function pause(){
    if(running){
      running = false;
      cancelAnimationFrame(animationId);
    }
  }

  // setup canvas scaling for crisp rendering on high DPI
  function fixDPI(canvas, width, height){
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
    return ctx;
  }

  // prepare canvases
  fixDPI(boardCanvas, COLS*BLOCK, ROWS*BLOCK);
  fixDPI(nextCanvas, 140, 140);
  fixDPI(holdCanvas, 140, 140);

  // initial run
  init();

  // expose global for debugging if needed
  window.tetris = {
    init, start, pause, hardDrop, softDrop
  };
})();