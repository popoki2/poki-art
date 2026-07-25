data.anime = data.anime || [];
data.meme = data.meme || [];
data.lol = data.lol || [];
        data.game = data.game || ['카데나', '메르세데스', '신궁', '루미너스', '라라', '엔젤릭버스터', '끝없는고통', '리스트레인트링', '컨티뉴어스링', '메이린', '레테', '아델', '카이저', '제논', '은월', '와일드헌터', '블래스터', '칼리', '아크', '데몬슬레이어', '메카닉', '스트라이커', '윈드브레이커', '섀도어', '나이트로드', '듀얼블레이드', '플레임위자드', '비숍', '팔라딘', '패스파인더', '야생의포효', '급속성장', '혼절시키기', '마술사의수습생', '혈법사탈노스', '에드윈벤클리프', '파멸의예언자', '티리온폴드링', '말리고스', '화염구', '마법차', '난투', '폭발의덫', '사술', '퀘스트중인모험가', '생각훔치기', '뒤틀린황천', '배틀메이', '왕의축', '불기둥', '야생의벗', '그롬마쉬헬스크림', '휘둘러치', '압도적인힘', '시체되살리기', '난투', '걸신들린무타누', '평등', '데스윙', '제왕타우릿산', '크림슨발록', '일리움', '보우마스터', '가젯잔경매인', '질리악스', '리로이젠킨스', '얼음회오리', '비겁한밀고자', '장의사', '흑기사', '두억시', '자쿰', '혼테일', '핑크빈', '진힐라', '더스크', '루시드', '칼로스', '세렌', '카링', '가디언엔젤슬라임', '우서', '안두인', '제이나', '굴단', '발리라', '말퓨리온', '일리단', '가로쉬', '이글거리는전쟁도끼', '그림자밟기', '마음가짐', '렉사르', '해적패치스', '정신자극', '얼음방패', '리노잭슨', '대마법사안토니다스', '스랄', '파풀라투스', '데미안', '스우', '아카이럼', '벨룸', '듄켈',];
        data.object = data.object || ['시계', '포크레인', '에어컨', '김치냉장고', '엉덩이', '가슴', '분쇄기', '인형', '하츠네미쿠인형', '릴', '아이코스', '마일드세븐', '전자담배', '유산균', '냉장고', '선풍기', '스마트폰', '의자', '연필', '지우개', '안경'];
        data.game = data.game || ['카데나', '메르세데스', '신궁', '루미너스', '라라', '엔젤릭버스터', '아델', '카이저', '제논', '은월', '비숍', '팔라딘', '패스파인더', '자쿰', '혼테일', '핑크빈', '진힐라', '더스크', '루시드', '칼로스', '세렌', '카링', '데미안', '스우', '아카이럼', '벨룸', '듄켈'];
        data.object = data.object || ['시계', '포크레인', '에어컨', '김치냉장고', '냉장고', '선풍기', '스마트폰', '의자', '연필', '지우개', '안경'];

data.all = Array.from(new Set([
...data.food, ...data.anime, ...data.meme,
@@ -118,6 +118,8 @@ io.on('connection', (socket) => {
return;
}

        // 최신 DB 상태 재로드 후 검증
        usersDB = loadUsersDB();
if (usersDB[username]) {
socket.emit('authError', '이미 존재하는 아이디입니다.');
return;
@@ -140,6 +142,7 @@ io.on('connection', (socket) => {
});

socket.on('login', ({ username, password }) => {
        usersDB = loadUsersDB(); // DB 동기화
const user = usersDB[username];

if (!user) {
@@ -154,14 +157,15 @@ io.on('connection', (socket) => {

currentUser.username = username;
currentUser.nickname = user.nickname;
        lobbyUsers[socket.id] = { id: socket.id, ...user };
        lobbyUsers[socket.id] = { id: socket.id, username, ...user };

socket.emit('loginSuccess', { username, ...user, shopCatalog: SHOP_ITEMS });
io.emit('updateLobbyUsers', Object.values(lobbyUsers));
socket.emit('updateRoomList', getPublicRoomList());
});

socket.on('buyItem', ({ itemType, itemId }) => {
        usersDB = loadUsersDB();
const user = usersDB[currentUser.username];
if (!user) return;

@@ -183,6 +187,7 @@ io.on('connection', (socket) => {
});

socket.on('equipItem', ({ itemType, itemId }) => {
        usersDB = loadUsersDB();
const user = usersDB[currentUser.username];
if (!user || !user.inventory.includes(itemId)) return;

@@ -198,7 +203,7 @@ io.on('connection', (socket) => {
}

saveUsersDB(usersDB);
        lobbyUsers[socket.id] = { id: socket.id, ...user };
        lobbyUsers[socket.id] = { id: socket.id, username: currentUser.username, ...user };

socket.emit('profileUpdated', user);
io.emit('updateLobbyUsers', Object.values(lobbyUsers));
@@ -222,6 +227,7 @@ io.on('connection', (socket) => {
maxPlayers: parseInt(roomConfig.maxPlayers) || 6,
roundTime: parseInt(roomConfig.roundTime) || 60,
category: roomConfig.category || 'all',
            hostId: socket.id, // 방장 설정
players: [],
drawerIndex: -1,
currentWord: '',
@@ -243,13 +249,15 @@ io.on('connection', (socket) => {
if (!room) return socket.emit('joinError', '존재하지 않는 방입니다.');
if (room.password && room.password !== password) return socket.emit('joinError', '비밀번호가 일치하지 않습니다!');
if (room.players.length >= room.maxPlayers) return socket.emit('joinError', '방 인원이 가득 찼습니다.');
        if (room.isPlaying) return socket.emit('joinError', '이미 게임이 진행 중인 방입니다.');

delete lobbyUsers[socket.id];
io.emit('updateLobbyUsers', Object.values(lobbyUsers));

currentUser.roomId = roomId;
socket.join(roomId);

        usersDB = loadUsersDB();
const user = usersDB[currentUser.username] || {};
const player = { 
id: socket.id, 
@@ -262,14 +270,27 @@ io.on('connection', (socket) => {
};
room.players.push(player);

        socket.emit('roomJoined', room);
        io.to(roomId).emit('updatePlayers', room.players);
        socket.emit('roomJoined', { ...room, isHost: room.hostId === socket.id });
        io.to(roomId).emit('updatePlayers', { players: room.players, hostId: room.hostId });
io.to(roomId).emit('chatMessage', { sender: 'SYSTEM', text: `${currentUser.nickname} 님이 입장하셨습니다!` });
io.emit('updateRoomList', getPublicRoomList());
    });

    // 🎯 방장에 의한 수동 게임 시작
    socket.on('requestStartGame', () => {
        const roomId = currentUser.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        if (room.players.length >= 2 && !room.isPlaying) {
            startGame(roomId);
        if (room.hostId !== socket.id) {
            return socket.emit('chatMessage', { sender: 'SYSTEM', text: '❌ 방장만 게임을 시작할 수 있습니다.' });
}
        if (room.players.length < 2) {
            return socket.emit('chatMessage', { sender: 'SYSTEM', text: '❌ 최소 2명 이상의 플레이어가 필요합니다.' });
        }
        if (room.isPlaying) return;

        startGame(roomId);
});

socket.on('leaveRoom', () => { leaveCurrentRoom(socket); });
@@ -299,24 +320,22 @@ io.on('connection', (socket) => {

if (drawer) {
drawer.score += 20;
            usersDB = loadUsersDB();
if (usersDB[drawer.username]) {
usersDB[drawer.username].points += 10;
usersDB[drawer.username].exp += 5;
saveUsersDB(usersDB);
}
}

        io.to(roomId).emit('updatePlayers', room.players);
        io.to(roomId).emit('updatePlayers', { players: room.players, hostId: room.hostId });
io.to(roomId).emit('likeEffect', { sender: currentUser.nickname });
io.to(roomId).emit('chatMessage', { 
sender: 'SYSTEM 👍', 
text: `${currentUser.nickname} 님이 출제자에게 개추를 박았습니다! (출제자 +20pt)` 
});
});

    // ==========================================
    // 🎯 [핵심] 점수 차등 계산 및 DB 연동 로직
    // ==========================================
socket.on('chatMessage', (msg) => {
const roomId = currentUser.roomId;
if (!roomId || !rooms[roomId]) return;
@@ -340,45 +359,37 @@ io.on('connection', (socket) => {
if (player) {
room.solvedPlayers.push(socket.id);

                // 1. 등수 기반 기본 점수 (1등: 150점, 2등: 130점, 3등: 110점...)
                const solveOrder = room.solvedPlayers.length; // 1, 2, 3...
                const solveOrder = room.solvedPlayers.length;
const baseScore = Math.max(150 - (solveOrder - 1) * 20, 50);

                // 2. 제한시간 비율 계산 (남은 시간 / 전체 라운드 시간)
const timeRatio = room.timeLeft / room.roundTime;

                // 3. 최종 차등 점수 산출 (최소 30점 보장)
const earnedScore = Math.max(Math.floor(baseScore * (0.5 + timeRatio * 0.5)), 30);

                // 인게임 룸 점수 반영
player.score += earnedScore;
                if (drawer) drawer.score += 20; // 정답자가 나올 때마다 출제자도 보너스
                if (drawer) drawer.score += 20;

                // 4. 유저 DB(usersDB.json) 개인 계정 포인트 & 경험치 적립
                usersDB = loadUsersDB();
if (usersDB[currentUser.username]) {
const u = usersDB[currentUser.username];
                    u.points += earnedScore; // 맞힌 차등 점수가 그대로 개인 어카운트 포인트로 적립!
                    u.points += earnedScore;
u.exp += Math.floor(earnedScore * 0.8);

                    // 레벨업 체크
const neededExp = u.level * 100;
if (u.exp >= neededExp) {
u.exp -= neededExp;
u.level += 1;
socket.emit('chatMessage', { sender: 'SYSTEM 🎊', text: `축하합니다! 레벨이 상승하여 [LV.${u.level}] 이 되었습니다!` });
}
saveUsersDB(usersDB);
                    socket.emit('profileUpdated', u); // 프로필 UI 최신화
                    socket.emit('profileUpdated', u);
}

                io.to(roomId).emit('updatePlayers', room.players);
                io.to(roomId).emit('updatePlayers', { players: room.players, hostId: room.hostId });
io.to(roomId).emit('correctAnswerOverlay', { winner: currentUser.nickname, word: room.currentWord });
io.to(roomId).emit('chatMessage', { 
sender: 'SYSTEM 🎉', 
text: `[${solveOrder}등 정답!] ${currentUser.nickname} 님 정답(${room.currentWord})! (+${earnedScore}pt 획득)` 
});

                // 모든 플레이어가 맞힌 경우 다음 턴으로 즉시 전환
if (room.solvedPlayers.length >= room.players.length - 1) {
nextTurn(roomId);
}
@@ -412,8 +423,14 @@ function leaveCurrentRoom(socket) {
if (playerIndex !== -1) {
room.players.splice(playerIndex, 1);
socket.leave(roomId);

            // 방장이 나간 경우 다음 사람에게 방장 위임
            if (room.hostId === socket.id && room.players.length > 0) {
                room.hostId = room.players[0].id;
            }

            io.to(roomId).emit('updatePlayers', { players: room.players, hostId: room.hostId });

            io.to(roomId).emit('updatePlayers', room.players);
if (room.players.length === 0) {
clearInterval(room.timer);
delete rooms[roomId];
@@ -441,6 +458,12 @@ function startGame(roomId) {
room.isPlaying = true;
room.currentRound = 1;
room.drawerIndex = -1;
    
    // 점수 초기화
    room.players.forEach(p => p.score = 0);
    io.to(roomId).emit('updatePlayers', { players: room.players, hostId: room.hostId });
    io.emit('updateRoomList', getPublicRoomList());

nextTurn(roomId);
}

@@ -462,14 +485,15 @@ function nextTurn(roomId) {
room.isPlaying = false;
const sorted = [...room.players].sort((a, b) => b.score - a.score);

        // 최종 1등 유저에게 추가 우승 상금 적립
        usersDB = loadUsersDB();
if (sorted[0] && usersDB[sorted[0].username]) {
usersDB[sorted[0].username].points += 300;
usersDB[sorted[0].username].exp += 100;
saveUsersDB(usersDB);
}

io.to(roomId).emit('gameOver', sorted);
        io.emit('updateRoomList', getPublicRoomList());
return;
}

@@ -830,6 +854,8 @@ function getHTMLContent() {
                   <div class="window-header" style="font-size:11px;">PLAYERS</div>
                   <div id="game-player-list" style="margin-top:6px;"></div>
               </div>
                <!-- 🎯 방장 전용 게임 시작 버튼 -->
                <button id="start-game-btn" class="tool-btn" onclick="requestStartGame()" style="display:none; width:100%; margin-top:10px; background:#4caf50; color:#fff; font-size:14px; padding:8px;">▶️ 게임 시작</button>
           </div>

           <div id="canvas-container">
@@ -894,6 +920,7 @@ function getHTMLContent() {
       }

       socket.on('authError', (msg) => alert(msg));
        socket.on('joinError', (msg) => alert(msg));
       socket.on('authSuccess', (data) => {
           alert(data.message);
           toggleAuthMode('login');
@@ -912,7 +939,7 @@ function getHTMLContent() {
               loadingOverlay.style.display = 'none';
               document.getElementById('lobby-screen').style.display = 'flex';
               updateProfileUI(userData);
            }, 1800);
            }, 1000);
       });

       function updateProfileUI(u) {
@@ -1031,9 +1058,7 @@ function getHTMLContent() {
           socket.emit('fillCanvas', currentColor);
       }

        function sendLike() {
            socket.emit('sendLike');
        }
        function sendLike() { socket.emit('sendLike'); }

       socket.on('likeEffect', (d) => {
           const effect = document.getElementById('like-effect');
@@ -1056,7 +1081,7 @@ function getHTMLContent() {
               const item = document.createElement('div');
               item.className = 'user-item';
               item.style = u.borderStyle || '';
                item.innerText = \`[\${u.title || '포키'}] \${u.badge || '🌸'} \${u.nickname} (LV.\${u.level || 1})\`;
                item.innerText = \`[\${u.title || '신입'}] \${u.badge || '🔰'} \${u.nickname} (LV.\${u.level || 1})\`;
               box.appendChild(item);
           });
       });
@@ -1071,7 +1096,7 @@ function getHTMLContent() {
               card.onclick = () => joinRoomById(r.id, r.isLocked);
               card.innerHTML = \`
                   <div style="font-weight:900; font-size:14px; display:flex; justify-content:space-between;">
                        <span>#\${r.roomNum} \${r.title}</span><span>\${r.isLocked ? '🔒' : '🔓'}</span>
                        <span>#\${r.roomNum} \${r.title}</span><span>\${r.isLocked ? '🔒' : '🔓'}\${r.isPlaying ? ' [게임 중]' : ''}</span>
                   </div>
                   <div style="font-size:11px; color:#ad1457;">[주제: \${r.category.toUpperCase()}] | 인원: \${r.currentPlayers}/\${r.maxPlayers}</div>
               \`;
@@ -1114,9 +1139,9 @@ function getHTMLContent() {
       }

       function quickJoin() {
            const available = currentRoomList.find(r => !r.isLocked && r.currentPlayers < r.maxPlayers);
            const available = currentRoomList.find(r => !r.isLocked && !r.isPlaying && r.currentPlayers < r.maxPlayers);
           if (available) socket.emit('joinRoom', { roomId: available.id, password: '' });
            else alert('입장 가능한 공개 방이 없습니다.');
            else alert('입장 가능한 대기 중인 공개 방이 없습니다.');
       }

       socket.on('roomJoined', (room) => {
@@ -1125,6 +1150,10 @@ function getHTMLContent() {
           document.getElementById('game-room-title').innerText = room.title;
       });

        function requestStartGame() {
            socket.emit('requestStartGame');
        }

       function confirmLeaveRoom() {
           if (confirm("퇴장하시겠습니까?")) {
               socket.emit('leaveRoom');
@@ -1133,16 +1162,25 @@ function getHTMLContent() {
           }
       }

        socket.on('updatePlayers', (players) => {
        socket.on('updatePlayers', ({ players, hostId }) => {
           const list = document.getElementById('game-player-list');
           list.innerHTML = '';
           players.forEach(p => {
               const card = document.createElement('div');
               card.className = 'player-card';
               card.style = p.borderStyle || '';
                card.innerHTML = \`<span>\${p.badge || ''} \${p.name}</span><span style="color:#d81b60;">\${p.score}pt</span>\`;
                const isHostTag = (p.id === hostId) ? ' 👑' : '';
                card.innerHTML = \`<span>\${p.badge || ''} \${p.name}\${isHostTag}</span><span style="color:#d81b60;">\${p.score}pt</span>\`;
               list.appendChild(card);
           });

            // 내가 방장이면 시작 버튼 표시
            const startBtn = document.getElementById('start-game-btn');
            if (socket.id === hostId) {
                startBtn.style.display = 'block';
            } else {
                startBtn.style.display = 'none';
            }
       });

       socket.on('turnStart', (data) => {
@@ -1187,6 +1225,6 @@ function getHTMLContent() {
server.listen(PORT, () => {
console.log(`=================================================`);
console.log(` Poki Party (ポキパティ！！) 서버 가동 성공!`);
    console.log(` 점수 차등제 & 유저 DB 개인 포인트 연동 완료!`);
    console.log(` 멀티플레이어 대기실 및 계정 동기화 버그 수정 완료!`);
console.log(`=================================================`);
});
