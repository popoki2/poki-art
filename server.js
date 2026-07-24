const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Body 파서 설정
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 기본 제시어 데이터베이스 (카테고리별)
let wordDatabase = {
    food: ["떡볶이", "초밥", "마라탕", "붕어빵", "파스타", "짜장면", "탕수육", "치킨"],
    anime: ["피카츄", "도라에몽", "하츠네미쿠", "귀멸의칼날", "원피스", "슬램덩크", "건담"],
    daily: ["시계", "세탁기", "포크레인", "안경", "우산", "자전거", "냉장고", "선풍기"],
    meme: ["중꺾마", "엄준식", "엄", "밈", "어쩔티비", "무야호", "세트"]
};

// 방 관리 객체
const rooms = {};

// 📌 [수정 핵심] 어떤 주소로 들어오든 404/Not Found 없이 무조건 메인 게임 HTML을 응답하도록 보장!
app.get('*', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(getHTMLContent());
});

// 관리자 제시어 추가 API (비밀번호: poki1234)
app.post('/api/add-word', (req, res) => {
    const { password, category, word } = req.body;
    if (password !== 'poki1234') {
        return res.status(403).json({ success: false, message: '비밀번호가 틀렸습니다!' });
    }
    if (!wordDatabase[category]) {
        wordDatabase[category] = [];
    }
    if (!wordDatabase[category].includes(word)) {
        wordDatabase[category].push(word);
    }
    res.json({ success: true, message: `'${word}' 제시어가 [${category}] 카테고리에 추가되었습니다!`, db: wordDatabase });
});

// Socket.IO 실시간 이벤트 처리
io.on('connection', (socket) => {
    let currentRoom = null;
    let username = '';

    socket.on('joinRoom', ({ roomId, name }) => {
        currentRoom = roomId || 'POKI_ROOM';
        username = name || '무명포키';

        socket.join(currentRoom);

        if (!rooms[currentRoom]) {
            rooms[currentRoom] = {
                id: currentRoom,
                players: [],
                drawerIndex: 0,
                currentWord: '',
                timer: null,
                timeLeft: 60,
                isPlaying: false
            };
        }

        const room = rooms[currentRoom];
        const player = { id: socket.id, name: username, score: 0 };
        room.players.push(player);

        io.to(currentRoom).emit('updatePlayers', room.players);
        io.to(currentRoom).emit('chatMessage', { sender: 'SYSTEM', text: `${username} 님이 입장하셨습니다! ♡` });

        if (room.players.length >= 2 && !room.isPlaying) {
            startGame(currentRoom);
        }
    });

    socket.on('draw', (data) => {
        if (currentRoom) {
            socket.to(currentRoom).emit('draw', data);
        }
    });

    socket.on('clearCanvas', () => {
        if (currentRoom) {
            io.to(currentRoom).emit('clearCanvas');
        }
    });

    socket.on('chatMessage', (msg) => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];

        if (room.isPlaying && msg.trim() === room.currentWord) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                player.score += 150;
                io.to(currentRoom).emit('updatePlayers', room.players);
                io.to(currentRoom).emit('chatMessage', { 
                    sender: 'SYSTEM', 
                    text: `🎉 [정답!] ${username} 님이 정답(${room.currentWord})을 맞히셨습니다! (+150pt)` 
                });
                nextTurn(currentRoom);
            }
        } else {
            io.to(currentRoom).emit('chatMessage', { sender: username, text: msg });
        }
    });

    socket.on('disconnect', () => {
        if (currentRoom && rooms[currentRoom]) {
            const room = rooms[currentRoom];
            room.players = room.players.filter(p => p.id !== socket.id);
            io.to(currentRoom).emit('updatePlayers', room.players);
            io.to(currentRoom).emit('chatMessage', { sender: 'SYSTEM', text: `${username} 님이 퇴장하셨습니다.` });

            if (room.players.length < 2) {
                clearInterval(room.timer);
                room.isPlaying = false;
                io.to(currentRoom).emit('chatMessage', { sender: 'SYSTEM', text: '인원이 부족하여 게임이 대기 상태로 전환됩니다.' });
            }
        }
    });
});

function getChosung(str) {
    const cho = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
    let result = "";
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i) - 44032;
        if (code >= 0 && code <= 11172) {
            result += cho[Math.floor(code / 588)];
        } else {
            result += str[i];
        }
    }
    return result;
}

function startGame(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    room.isPlaying = true;
    room.drawerIndex = 0;
    nextTurn(roomId);
}

function nextTurn(roomId) {
    const room = rooms[roomId];
    if (!room || room.players.length === 0) return;

    clearInterval(room.timer);

    room.drawerIndex = (room.drawerIndex + 1) % room.players.length;
    const drawer = room.players[room.drawerIndex];

    const allWords = Object.values(wordDatabase).flat();
    room.currentWord = allWords[Math.floor(Math.random() * allWords.length)];
    room.timeLeft = 60;

    io.to(roomId).emit('clearCanvas');

    room.players.forEach(p => {
        if (p.id === drawer.id) {
            io.to(p.id).emit('turnStart', { isDrawer: true, word: room.currentWord, drawerName: drawer.name });
        } else {
            io.to(p.id).emit('turnStart', { isDrawer: false, word: '???', drawerName: drawer.name });
        }
    });

    room.timer = setInterval(() => {
        room.timeLeft--;
        io.to(roomId).emit('timerUpdate', room.timeLeft);

        if (room.timeLeft === 30) {
            const chosung = getChosung(room.currentWord);
            io.to(roomId).emit('chatMessage', { sender: 'SYSTEM 💡 힌트', text: `초성 힌트: [ ${chosung} ]` });
        }

        if (room.timeLeft <= 0) {
            clearInterval(room.timer);
            io.to(roomId).emit('chatMessage', { sender: 'SYSTEM', text: `시간 초과! 정답은 [ ${room.currentWord} ] 이었습니다.` });
            setTimeout(() => nextTurn(roomId), 3000);
        }
    }, 1000);
}

function getHTMLContent() {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ポキアト！！ (poki art ! !)</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=DungGeunMo&display=swap');
        * { box-sizing: border-box; font-family: 'DungGeunMo', monospace; user-select: none; }
        body {
            margin: 0; padding: 15px;
            background: #18052e;
            background-image: linear-gradient(0deg, rgba(255, 0, 128, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 0, 128, 0.08) 1px, transparent 1px);
            background-size: 20px 20px;
            color: #fff; display: flex; flex-direction: column; align-items: center; min-height: 100vh;
        }
        .window {
            background: #2a0845; border: 2px solid #ff007f;
            box-shadow: 0 0 12px #ff007f, inset 0 0 8px rgba(0,255,255,0.3);
            border-radius: 8px; margin: 6px; overflow: hidden;
        }
        .window-header {
            background: linear-gradient(90deg, #ff007f, #7928ca);
            padding: 6px 12px; font-weight: bold; display: flex; justify-content: space-between; align-items: center;
            text-shadow: 0 0 5px #fff;
        }
        .window-body { padding: 10px; }
        
        #top-bar { width: 100%; max-width: 1050px; display: flex; justify-content: space-between; }
        .logo { font-size: 24px; color: #00ffff; text-shadow: 0 0 10px #00ffff, 0 0 20px #ff007f; }
        
        #main-container { width: 100%; max-width: 1050px; display: flex; gap: 10px; margin-top: 10px; }
        #left-panel { width: 200px; }
        #center-panel { flex: 1; display: flex; flex-direction: column; align-items: center; }
        #right-panel { width: 260px; }
        
        .player-card {
            background: #150228; border: 1px solid #00ffff; padding: 8px; margin-bottom: 6px;
            border-radius: 4px; display: flex; justify-content: space-between; align-items: center;
            box-shadow: 0 0 5px #00ffff;
        }

        canvas {
            background: #ffffff; border: 3px solid #00ffff; border-radius: 6px;
            box-shadow: 0 0 15px #00ffff; cursor: crosshair; touch-action: none;
        }

        #toolbar {
            width: 100%; margin-top: 10px; display: flex; justify-content: space-between; align-items: center;
            background: #220338; border: 1px solid #ff007f; padding: 8px; border-radius: 6px;
        }
        .color-palette { display: flex; gap: 4px; flex-wrap: wrap; max-width: 280px; }
        .color-btn { width: 22px; height: 22px; border-radius: 3px; border: 1px solid #fff; cursor: pointer; }
        .color-btn:hover { transform: scale(1.15); }
        
        #chat-messages {
            height: 380px; background: #120120; border: 1px solid #ff007f; padding: 8px;
            overflow-y: auto; font-size: 13px; display: flex; flex-direction: column; gap: 4px;
        }
        .chat-input-box { display: flex; gap: 4px; margin-top: 6px; }
        input[type="text"] {
            background: #080010; border: 1px solid #00ffff; color: #00ffff; padding: 6px;
            border-radius: 4px; outline: none; width: 100%;
        }
        button {
            background: linear-gradient(180deg, #ff007f, #a00050); border: none; color: #fff;
            padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold;
            box-shadow: 0 0 6px #ff007f;
        }
        button:hover { filter: brightness(1.2); }

        .modal {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.85); display: flex; justify-content: center; align-items: center; z-index: 999;
        }
        .modal-content { width: 320px; text-align: center; }
    </style>
</head>
<body>

    <div id="join-modal" class="modal">
        <div class="window modal-content">
            <div class="window-header">ポキアト！！ 입장하기 ♡</div>
            <div class="window-body">
                <p style="color:#00ffff;">닉네임을 입력해 주세요!</p>
                <input type="text" id="username-input" placeholder="닉네임..." value="친구포키" style="margin-bottom:12px;">
                <button onclick="joinGame()" style="width:100%;">게임 접속하기 🚀</button>
            </div>
        </div>
    </div>

    <div id="top-bar" class="window">
        <div class="window-header" style="width:100%;">
            <span class="logo">ポキアト！！ (poki art ! !)</span>
            <span>⏰ 남은시간: <span id="timer" style="color:#00ffff;">60</span>초</span>
            <span>💡 제시어: <span id="word-display" style="color:#ff007f; font-size:18px;">대기 중...</span></span>
            <button onclick="toggleAdminModal()" style="font-size:10px; background:#7928ca;">⚙️ 제시어 추가</button>
        </div>
    </div>

    <div id="main-container">
        <div id="left-panel" class="window">
            <div class="window-header">♥ PLAYERS</div>
            <div class="window-body" id="player-list"></div>
        </div>

        <div id="center-panel">
            <div class="window" style="padding: 6px;">
                <canvas id="canvas" width="540" height="420"></canvas>
            </div>
            
            <div id="toolbar">
                <div class="color-palette" id="palette"></div>
                <div style="display:flex; gap:6px; align-items:center;">
                    <button onclick="setPenWidth(2)">•</button>
                    <button onclick="setPenWidth(6)">●</button>
                    <button onclick="setPenWidth(14)">🔴</button>
                    <button onclick="useEraser()" style="background:#444;">지우개</button>
                    <button onclick="clearCanvas()" style="background:#d32f2f;">전체 지우기</button>
                </div>
            </div>
        </div>

        <div id="right-panel" class="window">
            <div class="window-header">♥ CHAT & ANSWER</div>
            <div class="window-body">
                <div id="chat-messages"></div>
                <div class="chat-input-box">
                    <input type="text" id="chat-input" placeholder="정답 또는 채팅 입력..." onkeypress="if(event.key==='Enter') sendChat()">
                    <button onclick="sendChat()">전송</button>
                </div>
            </div>
        </div>
    </div>

    <div id="admin-modal" class="modal" style="display:none;">
        <div class="window modal-content">
            <div class="window-header">⚙️ Custom Word Admin</div>
            <div class="window-body" style="display:flex; flex-direction:column; gap:8px;">
                <input type="password" id="admin-pass" placeholder="관리자 비밀번호 (poki1234)">
                <select id="admin-category" style="background:#080010; color:#00ffff; padding:6px; border:1px solid #00ffff; border-radius:4px;">
                    <option value="food">음식 (Food)</option>
                    <option value="anime">애니/게임 (Anime)</option>
                    <option value="daily">일상단어 (Daily)</option>
                    <option value="meme">밈 (Meme)</option>
                </select>
                <input type="text" id="admin-word" placeholder="추가할 제시어 입력...">
                <button onclick="submitCustomWord()">제시어 DB 추가하기</button>
                <button onclick="toggleAdminModal()" style="background:#555;">닫기</button>
            </div>
        </div>
    </div>

    <script>
        const socket = io();
        let isDrawer = false;
        let currentColor = '#000000';
        let currentWidth = 4;
        let isDrawing = false;

        const canvas = document.getElementById('canvas');
        const ctx = canvas.getContext('2d');

        const colors = [
            '#000000', '#ffffff', '#ff007f', '#00ffff', '#7928ca', '#ff0000', 
            '#ff7700', '#ffeb3b', '#4caf50', '#2196f3', '#9c27b0', '#e91e63',
            '#ffb6c1', '#a8e6cf', '#dcedc1', '#ffd3b6', '#ff8b94', '#845ec2', '#d65db1', '#ff6f91'
        ];
        const paletteContainer = document.getElementById('palette');
        colors.forEach(c => {
            const btn = document.createElement('div');
            btn.className = 'color-btn';
            btn.style.background = c;
            btn.onclick = () => { currentColor = c; };
            paletteContainer.appendChild(btn);
        });

        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseleave', stopDrawing);

        function startDrawing(e) {
            if (!isDrawer) return;
            isDrawing = true;
            const pos = getCanvasPos(e);
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            socket.emit('draw', { type: 'start', x: pos.x, y: pos.y, color: currentColor, width: currentWidth });
        }

        function draw(e) {
            if (!isDrawing || !isDrawer) return;
            const pos = getCanvasPos(e);
            ctx.lineTo(pos.x, pos.y);
            ctx.strokeStyle = currentColor;
            ctx.lineWidth = currentWidth;
            ctx.lineCap = 'round';
            ctx.stroke();
            socket.emit('draw', { type: 'draw', x: pos.x, y: pos.y, color: currentColor, width: currentWidth });
        }

        function stopDrawing() { isDrawing = false; }

        function getCanvasPos(e) {
            const rect = canvas.getBoundingClientRect();
            return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        }

        function setPenWidth(w) { currentWidth = w; }
        function useEraser() { currentColor = '#ffffff'; }
        function clearCanvas() { if (isDrawer) socket.emit('clearCanvas'); }

        socket.on('draw', (data) => {
            if (data.type === 'start') {
                ctx.beginPath();
                ctx.moveTo(data.x, data.y);
            } else if (data.type === 'draw') {
                ctx.lineTo(data.x, data.y);
                ctx.strokeStyle = data.color;
                ctx.lineWidth = data.width;
                ctx.lineCap = 'round';
                ctx.stroke();
            }
        });

        socket.on('clearCanvas', () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        });

        socket.on('updatePlayers', (players) => {
            const list = document.getElementById('player-list');
            list.innerHTML = '';
            players.forEach(p => {
                const card = document.createElement('div');
                card.className = 'player-card';
                card.innerHTML = \`<span>\${p.name}</span> <span style="color:#00ffff;">\${p.score}pt</span>\`;
                list.appendChild(card);
            });
        });

        socket.on('turnStart', (data) => {
            isDrawer = data.isDrawer;
            document.getElementById('word-display').innerText = data.word;
            addChatMessage({ sender: 'SYSTEM', text: \`🎨 [출제자]: \${data.drawerName} 님이 그림을 그릴 차례입니다!\` });
        });

        socket.on('timerUpdate', (time) => {
            document.getElementById('timer').innerText = time;
        });

        socket.on('chatMessage', (data) => {
            addChatMessage(data);
        });

        function addChatMessage(data) {
            const box = document.getElementById('chat-messages');
            const msg = document.createElement('div');
            if (data.sender === 'SYSTEM' || data.sender.includes('SYSTEM')) {
                msg.style.color = '#ff007f';
                msg.style.fontWeight = 'bold';
            } else {
                msg.style.color = '#00ffff';
            }
            msg.innerText = \`[\${data.sender}]: \${data.text}\`;
            box.appendChild(msg);
            box.scrollTop = box.scrollHeight;
        }

        function sendChat() {
            const input = document.getElementById('chat-input');
            if (input.value.trim() !== '') {
                socket.emit('chatMessage', input.value.trim());
                input.value = '';
            }
        }

        function joinGame() {
            const name = document.getElementById('username-input').value.trim();
            if (name) {
                socket.emit('joinRoom', { roomId: 'POKI_ROOM', name });
                document.getElementById('join-modal').style.display = 'none';
            }
        }

        function toggleAdminModal() {
            const modal = document.getElementById('admin-modal');
            modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
        }

        function submitCustomWord() {
            const password = document.getElementById('admin-pass').value;
            const category = document.getElementById('admin-category').value;
            const word = document.getElementById('admin-word').value.trim();

            fetch('/api/add-word', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password, category, word })
            })
            .then(res => res.json())
            .then(data => {
                alert(data.message);
                if (data.success) {
                    document.getElementById('admin-word').value = '';
                    toggleAdminModal();
                }
            });
        }
    </script>
</body>
</html>`;
}

server.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(` ポキアト！！ (poki art ! !) 게임 서버 가동 완료!`);
    console.log(`=================================================`);
});
