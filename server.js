const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 📁 파일 기반 데이터베이스 (JSON File DB)
// ==========================================
const USERS_DB_PATH = path.join(__dirname, 'usersDB.json');
const WORDS_DB_PATH = path.join(__dirname, 'wordsDB.json');

function loadUsersDB() {
    try {
        if (!fs.existsSync(USERS_DB_PATH)) {
            fs.writeFileSync(USERS_DB_PATH, '{}', 'utf8');
            return {};
        }
        const data = fs.readFileSync(USERS_DB_PATH, 'utf8');
        return JSON.parse(data || '{}');
    } catch (e) {
        console.error("유저 DB 로드 실패:", e);
        return {};
    }
}

function saveUsersDB(data) {
    try {
        fs.writeFileSync(USERS_DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error("유저 DB 저장 실패:", e);
    }
}

function loadWordsDB() {
    try {
        let data = {};
        if (fs.existsSync(WORDS_DB_PATH)) {
            data = JSON.parse(fs.readFileSync(WORDS_DB_PATH, 'utf8'));
        }

        data.food = data.food || [];
        data.anime = data.anime || [];
        data.meme = data.meme || [];
        data.lol = data.lol || [];
        data.game = data.game || ['카데나', '메르세데스', '신궁', '루미너스', '라라', '엔젤릭버스터', '끝없는고통', '리스트레인트링', '컨티뉴어스링', '메이린', '레테', '아델', '카이저', '제논', '은월', '와일드헌터', '블래스터', '칼리', '아크', '데몬슬레이어', '메카닉', '스트라이커', '윈드브레이커', '섀도어', '나이트로드', '듀얼블레이드', '플레임위자드', '비숍', '팔라딘', '패스파인더', '야생의포효', '급속성장', '혼절시키기', '마술사의수습생', '혈법사탈노스', '에드윈벤클리프', '파멸의예언자', '티리온폴드링', '말리고스', '화염구', '마법차', '난투', '폭발의덫', '사술', '퀘스트중인모험가', '생각훔치기', '뒤틀린황천', '배틀메이', '왕의축', '불기둥', '야생의벗', '그롬마쉬헬스크림', '휘둘러치', '압도적인힘', '시체되살리기', '난투', '걸신들린무타누', '평등', '데스윙', '제왕타우릿산', '크림슨발록', '일리움', '보우마스터', '가젯잔경매인', '질리악스', '리로이젠킨스', '얼음회오리', '비겁한밀고자', '장의사', '흑기사', '두억시', '자쿰', '혼테일', '핑크빈', '진힐라', '더스크', '루시드', '칼로스', '세렌', '카링', '가디언엔젤슬라임', '우서', '안두인', '제이나', '굴단', '발리라', '말퓨리온', '일리단', '가로쉬', '이글거리는전쟁도끼', '그림자밟기', '마음가짐', '렉사르', '해적패치스', '정신자극', '얼음방패', '리노잭슨', '대마법사안토니다스', '스랄', '파풀라투스', '데미안', '스우', '아카이럼', '벨룸', '듄켈',];
        data.object = data.object || ['시계', '포크레인', '에어컨', '김치냉장고', '엉덩이', '가슴', '분쇄기', '인형', '하츠네미쿠인형', '릴', '아이코스', '마일드세븐', '전자담배', '유산균', '냉장고', '선풍기', '스마트폰', '의자', '연필', '지우개', '안경'];

        data.all = Array.from(new Set([
            ...data.food, ...data.anime, ...data.meme,
            ...data.lol, ...data.game, ...data.object
        ]));

        return data;
    } catch (e) {
        console.error("단어 DB 로드 실패, 기본값 설정:", e);
        return { 
            food: ['계란볶음밥', '신라면'], anime: ['포켓몬스터', '도라에몽'], 
            meme: ['무야호', '어쩔티비'], lol: ['가렌', '티모'], 
            game: ['포켓몬스터', '마인크래프트'], object: ['시계', '스마트폰'], 
            all: ['계란볶음밥', '포켓몬스터', '무야호', '가렌', '시계'] 
        };
    }
}

let usersDB = loadUsersDB();
let wordDatabase = loadWordsDB();

const lobbyUsers = {};
const rooms = {};
let roomCounter = 500;

const SHOP_ITEMS = {
    titles: [
        { id: 't_newbie', name: '신입', price: 0, reqLevel: 1 },
        { id: 't_painter', name: '그림쟁이', price: 30000, reqLevel: 1 },
        { id: 't_picasso', name: '아티스트', price: 100000, reqLevel: 3 },
        { id: 't_god', name: '예술', price: 1000000, reqLevel: 5 }
    ],
    badges: [
        { id: 'b_default', name: '🔰 새싹', icon: '🔰', price: 0 },
        { id: 'b_cat', name: '🐱 야옹이', icon: '🐱', price: 20000 },
        { id: 'b_crown', name: '👑 왕관', icon: '👑', price: 50000 },
        { id: 'b_fire', name: '🔥 불꽃', icon: '🔥', price: 80000 }
    ],
    borders: [
        { id: 'brd_none', name: '기본 테두리', style: 'border: 2px solid #ea80fc;', price: 0 },
        { id: 'brd_gold', name: '골드 핑크 테두리', style: 'border: 3px solid #ffd700; box-shadow: 0 0 8px #ff4081;', price: 80000 },
        { id: 'brd_neon', name: '네온 퍼플 테두리', style: 'border: 3px solid #00e5ff; box-shadow: 0 0 10px #aa00ff;', price: 155700 }
    ]
};

app.get('*', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(getHTMLContent());
});

io.on('connection', (socket) => {
    let currentUser = { id: socket.id, username: '', nickname: '', roomId: null, lastMsgTime: 0, lastMsgText: '' };

    socket.on('register', ({ username, password, nickname }) => {
        const nickRegex = /^[a-zA-Z0-9가-힣]{2,8}$/;
        if (!nickRegex.test(nickname)) {
            socket.emit('authError', '닉네임은 2~8자의 한글, 영문, 숫자만 사용 가능합니다.');
            return;
        }
        if (!username || username.length < 3) {
            socket.emit('authError', '아이디는 3자 이상이어야 합니다.');
            return;
        }
        
        if (usersDB[username]) {
            socket.emit('authError', '이미 존재하는 아이디입니다.');
            return;
        }

        usersDB[username] = {
            password,
            nickname,
            points: 200,
            exp: 0,
            level: 1,
            title: '신입',
            badge: '🔰',
            borderStyle: 'border: 2px solid #ea80fc;',
            inventory: ['t_newbie', 'b_default', 'brd_none']
        };

        saveUsersDB(usersDB);
        socket.emit('authSuccess', { message: '회원가입이 완료되었습니다! 로그인해 주세요.' });
    });

    socket.on('login', ({ username, password }) => {
        const user = usersDB[username];
        
        if (!user) {
            socket.emit('authError', '존재하지 않는 아이디입니다.');
            return;
        }

        if (user.password !== password) {
            socket.emit('authError', '비밀번호가 올바르지 않습니다.');
            return;
        }

        currentUser.username = username;
        currentUser.nickname = user.nickname;
        lobbyUsers[socket.id] = { id: socket.id, ...user };

        socket.emit('loginSuccess', { username, ...user, shopCatalog: SHOP_ITEMS });
        io.emit('updateLobbyUsers', Object.values(lobbyUsers));
        socket.emit('updateRoomList', getPublicRoomList());
    });

    socket.on('buyItem', ({ itemType, itemId }) => {
        const user = usersDB[currentUser.username];
        if (!user) return;

        let item = null;
        if (itemType === 'titles') item = SHOP_ITEMS.titles.find(i => i.id === itemId);
        if (itemType === 'badges') item = SHOP_ITEMS.badges.find(i => i.id === itemId);
        if (itemType === 'borders') item = SHOP_ITEMS.borders.find(i => i.id === itemId);

        if (!item) return socket.emit('shopError', '존재하지 않는 아이템입니다.');
        if (user.inventory.includes(itemId)) return socket.emit('shopError', '이미 보유한 아이템입니다.');
        if (item.reqLevel && user.level < item.reqLevel) return socket.emit('shopError', `레벨 ${item.reqLevel} 이상만 구매 가능합니다!`);
        if (user.points < item.price) return socket.emit('shopError', '포인트가 부족합니다!');

        user.points -= item.price;
        user.inventory.push(itemId);
        saveUsersDB(usersDB);

        socket.emit('shopSuccess', { message: `'${item.name}' 구매 완료!`, user });
    });

    socket.on('equipItem', ({ itemType, itemId }) => {
        const user = usersDB[currentUser.username];
        if (!user || !user.inventory.includes(itemId)) return;

        if (itemType === 'titles') {
            const item = SHOP_ITEMS.titles.find(i => i.id === itemId);
            if (item) user.title = item.name;
        } else if (itemType === 'badges') {
            const item = SHOP_ITEMS.badges.find(i => i.id === itemId);
            if (item) user.badge = item.icon;
        } else if (itemType === 'borders') {
            const item = SHOP_ITEMS.borders.find(i => i.id === itemId);
            if (item) user.borderStyle = item.style;
        }

        saveUsersDB(usersDB);
        lobbyUsers[socket.id] = { id: socket.id, ...user };
        
        socket.emit('profileUpdated', user);
        io.emit('updateLobbyUsers', Object.values(lobbyUsers));
    });

    socket.on('lobbyChat', (msg) => {
        if (!currentUser.nickname) return;
        if (checkSpam(socket, currentUser, msg)) return;
        io.emit('lobbyChat', { sender: currentUser.nickname, text: msg });
    });

    socket.on('createRoom', (roomConfig) => {
        roomCounter++;
        const roomId = 'ROOM_' + roomCounter;

        rooms[roomId] = {
            id: roomId,
            roomNum: roomCounter,
            title: roomConfig.title || `${currentUser.nickname}님의 방`,
            password: roomConfig.password || '',
            maxPlayers: parseInt(roomConfig.maxPlayers) || 6,
            roundTime: parseInt(roomConfig.roundTime) || 60,
            category: roomConfig.category || 'all',
            players: [],
            drawerIndex: -1,
            currentWord: '',
            timer: null,
            timeLeft: 60,
            isPlaying: false,
            currentRound: 0,
            maxRounds: parseInt(roomConfig.maxRounds) || 3,
            solvedPlayers: [],
            likedPlayers: []
        };

        socket.emit('roomCreated', { roomId, password: roomConfig.password });
        io.emit('updateRoomList', getPublicRoomList());
    });

    socket.on('joinRoom', ({ roomId, password }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('joinError', '존재하지 않는 방입니다.');
        if (room.password && room.password !== password) return socket.emit('joinError', '비밀번호가 일치하지 않습니다!');
        if (room.players.length >= room.maxPlayers) return socket.emit('joinError', '방 인원이 가득 찼습니다.');

        delete lobbyUsers[socket.id];
        io.emit('updateLobbyUsers', Object.values(lobbyUsers));

        currentUser.roomId = roomId;
        socket.join(roomId);

        const user = usersDB[currentUser.username] || {};
        const player = { 
            id: socket.id, 
            name: currentUser.nickname, 
            score: 0, 
            username: currentUser.username,
            title: user.title || '신입',
            badge: user.badge || '🔰',
            borderStyle: user.borderStyle || ''
        };
        room.players.push(player);

        socket.emit('roomJoined', room);
        io.to(roomId).emit('updatePlayers', room.players);
        io.to(roomId).emit('chatMessage', { sender: 'SYSTEM', text: `${currentUser.nickname} 님이 입장하셨습니다!` });
        io.emit('updateRoomList', getPublicRoomList());

        if (room.players.length >= 2 && !room.isPlaying) {
            startGame(roomId);
        }
    });

    socket.on('leaveRoom', () => { leaveCurrentRoom(socket); });
    socket.on('draw', (data) => { if (currentUser.roomId) socket.to(currentUser.roomId).emit('draw', data); });
    socket.on('clearCanvas', () => { if (currentUser.roomId) io.to(currentUser.roomId).emit('clearCanvas'); });
    socket.on('fillCanvas', (color) => { if (currentUser.roomId) io.to(currentUser.roomId).emit('fillCanvas', color); });

    socket.on('sendLike', () => {
        const roomId = currentUser.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        if (!room.isPlaying) return;
        const drawer = room.players[room.drawerIndex];
        
        if (drawer && drawer.id === socket.id) {
            socket.emit('chatMessage', { sender: 'SYSTEM', text: '❌ 자신의 그림에는 개추를 누를 수 없습니다!' });
            return;
        }

        if (room.likedPlayers.includes(socket.id)) {
            socket.emit('chatMessage', { sender: 'SYSTEM', text: '⚠️ 이번 라운드에는 이미 개추를 눌렀습니다.' });
            return;
        }

        room.likedPlayers.push(socket.id);
        
        if (drawer) {
            drawer.score += 20;
            if (usersDB[drawer.username]) {
                usersDB[drawer.username].points += 10;
                usersDB[drawer.username].exp += 5;
                saveUsersDB(usersDB);
            }
        }

        io.to(roomId).emit('updatePlayers', room.players);
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
        const room = rooms[roomId];
        const drawer = room.players[room.drawerIndex];

        if (checkSpam(socket, currentUser, msg)) return;

        if (room.isPlaying && drawer && drawer.id === socket.id) {
            socket.emit('chatMessage', { sender: 'SYSTEM', text: '❌ 당신은 출제자입니다! 채팅이 제한됩니다.' });
            return;
        }

        if (room.isPlaying && room.solvedPlayers.includes(socket.id)) {
            socket.emit('chatMessage', { sender: 'SYSTEM', text: '❌ 이미 정답을 맞히셨습니다!' });
            return;
        }

        if (room.isPlaying && msg.trim() === room.currentWord) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                room.solvedPlayers.push(socket.id);

                // 1. 등수 기반 기본 점수 (1등: 150점, 2등: 130점, 3등: 110점...)
                const solveOrder = room.solvedPlayers.length; // 1, 2, 3...
                const baseScore = Math.max(150 - (solveOrder - 1) * 20, 50);

                // 2. 제한시간 비율 계산 (남은 시간 / 전체 라운드 시간)
                const timeRatio = room.timeLeft / room.roundTime;

                // 3. 최종 차등 점수 산출 (최소 30점 보장)
                const earnedScore = Math.max(Math.floor(baseScore * (0.5 + timeRatio * 0.5)), 30);

                // 인게임 룸 점수 반영
                player.score += earnedScore;
                if (drawer) drawer.score += 20; // 정답자가 나올 때마다 출제자도 보너스

                // 4. 유저 DB(usersDB.json) 개인 계정 포인트 & 경험치 적립
                if (usersDB[currentUser.username]) {
                    const u = usersDB[currentUser.username];
                    u.points += earnedScore; // 맞힌 차등 점수가 그대로 개인 어카운트 포인트로 적립!
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
                }

                io.to(roomId).emit('updatePlayers', room.players);
                io.to(roomId).emit('correctAnswerOverlay', { winner: currentUser.nickname, word: room.currentWord });
                io.to(roomId).emit('chatMessage', { 
                    sender: 'SYSTEM 🎉', 
                    text: `[${solveOrder}등 정답!] ${currentUser.nickname} 님 정답(${room.currentWord})! (+${earnedScore}pt 획득)` 
                });

                // 모든 플레이어가 맞힌 경우 다음 턴으로 즉시 전환
                if (room.solvedPlayers.length >= room.players.length - 1) {
                    nextTurn(roomId);
                }
            }
        } else {
            io.to(roomId).emit('chatMessage', { sender: currentUser.nickname, text: msg });
        }
    });

    socket.on('disconnect', () => {
        delete lobbyUsers[socket.id];
        io.emit('updateLobbyUsers', Object.values(lobbyUsers));
        leaveCurrentRoom(socket);
    });
});

function checkSpam(socket, user, msg) {
    const now = Date.now();
    if (now - user.lastMsgTime < 800) {
        socket.emit('chatMessage', { sender: 'SYSTEM ⚠️', text: '채팅이 너무 빠릅니다! 천천히 입력해 주세요.' });
        return true;
    }
    user.lastMsgTime = now;
    return false;
}

function leaveCurrentRoom(socket) {
    for (const roomId in rooms) {
        const room = rooms[roomId];
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== -1) {
            room.players.splice(playerIndex, 1);
            socket.leave(roomId);
            
            io.to(roomId).emit('updatePlayers', room.players);
            if (room.players.length === 0) {
                clearInterval(room.timer);
                delete rooms[roomId];
            } else if (room.players.length < 2 && room.isPlaying) {
                clearInterval(room.timer);
                room.isPlaying = false;
                io.to(roomId).emit('chatMessage', { sender: 'SYSTEM', text: '인원이 부족하여 대기 상태로 전환됩니다.' });
            }
            io.emit('updateRoomList', getPublicRoomList());
            break;
        }
    }
}

function getPublicRoomList() {
    return Object.values(rooms).map(r => ({
        id: r.id, roomNum: r.roomNum, title: r.title, isLocked: !!r.password,
        currentPlayers: r.players.length, maxPlayers: r.maxPlayers, category: r.category, isPlaying: r.isPlaying
    }));
}

function startGame(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    room.isPlaying = true;
    room.currentRound = 1;
    room.drawerIndex = -1;
    nextTurn(roomId);
}

function nextTurn(roomId) {
    const room = rooms[roomId];
    if (!room || room.players.length === 0) return;

    clearInterval(room.timer);
    room.solvedPlayers = [];
    room.likedPlayers = [];
    room.drawerIndex++;

    if (room.drawerIndex >= room.players.length) {
        room.drawerIndex = 0;
        room.currentRound++;
    }

    if (room.currentRound > room.maxRounds) {
        room.isPlaying = false;
        const sorted = [...room.players].sort((a, b) => b.score - a.score);
        
        // 최종 1등 유저에게 추가 우승 상금 적립
        if (sorted[0] && usersDB[sorted[0].username]) {
            usersDB[sorted[0].username].points += 300;
            usersDB[sorted[0].username].exp += 100;
            saveUsersDB(usersDB);
        }

        io.to(roomId).emit('gameOver', sorted);
        return;
    }

    const drawer = room.players[room.drawerIndex];
    const categoryList = wordDatabase[room.category] || wordDatabase.all;

    room.currentWord = categoryList[Math.floor(Math.random() * categoryList.length)];
    room.timeLeft = room.roundTime;

    io.to(roomId).emit('clearCanvas');

    const lengthHint = "_ ".repeat(room.currentWord.length).trim();

    room.players.forEach(p => {
        const isDrawer = (p.id === drawer.id);
        io.to(p.id).emit('turnStart', { 
            isDrawer, 
            word: isDrawer ? room.currentWord : lengthHint, 
            drawerName: drawer.name,
            round: room.currentRound,
            maxRounds: room.maxRounds
        });
    });

    room.timer = setInterval(() => {
        room.timeLeft--;
        io.to(roomId).emit('timerUpdate', room.timeLeft);

        if (room.timeLeft <= 0) {
            clearInterval(room.timer);
            io.to(roomId).emit('chatMessage', { sender: 'SYSTEM', text: `⏰ 시간 초과! 정답은 [ ${room.currentWord} ] 이었습니다.` });
            setTimeout(() => nextTurn(roomId), 2000);
        }
    }, 1000);
}

function getHTMLContent() {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ポキパティ！！ (Poki Party)</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=DungGeunMo&family=Noto+Sans+KR:wght@500;700;900&display=swap');
        * { box-sizing: border-box; font-family: 'Noto Sans KR', sans-serif; user-select: none; }
        
        body {
            margin: 0; padding: 10px; background: #fce4ec;
            background-image: radial-gradient(#f8bbd0 15%, transparent 16%), radial-gradient(#f8bbd0 15%, transparent 16%);
            background-size: 20px 20px; background-position: 0 0, 10px 10px;
            color: #4a148c; display: flex; flex-direction: column; align-items: center; min-height: 100vh;
        }

        .pixel-box {
            background: #ffffff; border: 3px solid #f06292;
            box-shadow: 4px 4px 0px #ba68c8; border-radius: 8px; overflow: hidden;
        }
        
        .window-header {
            background: linear-gradient(90deg, #ff80ab, #ea80fc);
            padding: 8px 12px; color: #fff; font-weight: 900; font-family: 'DungGeunMo';
            display: flex; justify-content: space-between; align-items: center;
            border-bottom: 2px solid #f06292; text-shadow: 1px 1px 0px #c2185b;
        }

        #loading-overlay {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(252, 228, 236, 0.95); display: none; flex-direction: column;
            justify-content: center; align-items: center; z-index: 9999;
        }
        .loading-title {
            font-family: 'DungGeunMo'; font-size: 32px; color: #d81b60; margin-bottom: 15px;
            text-shadow: 2px 2px 0px #f8bbd0; animation: pulse 1s infinite alternate;
        }
        .spinner {
            width: 50px; height: 50px; border: 5px solid #f8bbd0; border-top: 5px solid #ff4081;
            border-radius: 50%; animation: spin 0.8s linear infinite;
        }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes pulse { 0% { transform: scale(0.98); } 100% { transform: scale(1.03); } }

        .modal {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(74, 20, 140, 0.4); display: flex; justify-content: center; align-items: center; z-index: 999;
        }
        .modal-body { width: 420px; padding: 18px; background: #fff; display: flex; flex-direction: column; gap: 12px; }
        .form-group { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: bold; }
        input[type="text"], input[type="password"], select {
            border: 2px solid #f06292; border-radius: 4px; padding: 6px; font-weight: bold; outline: none; background: #fff;
        }

        #lobby-screen { width: 100%; max-width: 1000px; display: none; flex-direction: column; gap: 10px; }
        #lobby-main { display: flex; gap: 10px; height: 420px; }
        #lobby-left { width: 230px; display: flex; flex-direction: column; gap: 10px; }
        #user-list-box { flex: 1; overflow-y: auto; padding: 8px; background: #fff0f5; }
        .user-item { padding: 6px 8px; font-size: 13px; font-weight: bold; color: #880e4f; border-bottom: 1px dashed #f8bbd0; border-radius: 4px; margin-bottom: 4px; }
        
        #my-profile { padding: 10px; background: #f3e5f5; display: flex; flex-direction: column; gap: 4px; }
        .profile-badge { font-size: 11px; color: #7b1fa2; font-weight: bold; background: #e1bee7; padding: 2px 6px; border-radius: 4px; width: fit-content; }

        #lobby-center { flex: 1; display: flex; flex-direction: column; gap: 8px; }
        #category-bar { display: flex; gap: 6px; }
        .tab-btn {
            background: #ff80ab; color: #fff; border: 2px solid #c2185b; padding: 6px 14px;
            font-weight: bold; border-radius: 6px; cursor: pointer; box-shadow: 2px 2px 0 #880e4f;
        }
        .tab-btn:hover { background: #ff4081; }

        #room-grid {
            flex: 1; background: #fff; border: 2px solid #f06292; padding: 10px;
            display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, 100px); gap: 10px;
            overflow-y: auto;
        }
        
        .room-card {
            background: #fff5f8; border: 2px solid #ea80fc; border-radius: 6px; padding: 10px;
            display: flex; flex-direction: column; justify-content: space-between; cursor: pointer;
            box-shadow: 3px 3px 0 #ce93d8; transition: transform 0.1s;
        }
        .room-card:hover { transform: translateY(-2px); background: #f3e5f5; }

        #lobby-bottom { height: 140px; display: flex; flex-direction: column; }
        #lobby-chat { flex: 1; background: #fafafa; overflow-y: auto; padding: 8px; font-size: 13px; }

        .shop-tab-container { display: flex; gap: 4px; border-bottom: 2px solid #f06292; padding-bottom: 4px; }
        .shop-tab-btn { padding: 4px 10px; font-size: 12px; font-weight: bold; cursor: pointer; border-radius: 4px; background: #f3e5f5; border: 1px solid #ab47bc; }
        .shop-tab-btn.active { background: #ff80ab; color: #fff; border-color: #c2185b; }
        .shop-item-list { display: flex; flex-direction: column; gap: 8px; max-height: 250px; overflow-y: auto; padding: 4px; }
        .shop-item-card { display: flex; justify-content: space-between; align-items: center; background: #fff5f8; padding: 8px; border: 1px solid #f06292; border-radius: 6px; }

        #game-screen { width: 100%; max-width: 1000px; display: none; flex-direction: column; gap: 8px; }
        #game-header { display: flex; justify-content: space-between; align-items: center; padding: 6px 14px; }
        
        .word-hint-box {
            background: #fff; border: 2px solid #ff4081; padding: 4px 24px; border-radius: 20px;
            color: #d81b60; font-size: 22px; font-weight: 900; letter-spacing: 4px; font-family: 'DungGeunMo';
        }

        #game-main { display: flex; gap: 10px; }
        #game-players { width: 220px; padding: 6px; background: #fff0f5; display: flex; flex-direction: column; justify-content: space-between; }
        .player-card { background: #fff; padding: 6px; margin-bottom: 6px; border-radius: 6px; display: flex; justify-content: space-between; font-weight: bold; font-size: 13px; }

        #canvas-container { flex: 1; display: flex; flex-direction: column; align-items: center; }
        canvas { background: #ffffff; border: 3px solid #ff80ab; border-radius: 8px; cursor: crosshair; }
        
        #toolbar {
            width: 100%; margin-top: 6px; display: flex; justify-content: space-between; align-items: center;
            background: #fff; border: 2px solid #f06292; padding: 6px; border-radius: 6px;
        }
        .palette { display: flex; gap: 3px; max-width: 200px; flex-wrap: wrap; }
        .color-dot { width: 18px; height: 18px; border-radius: 3px; border: 1px solid #ccc; cursor: pointer; }

        .tool-btn {
            background: #f3e5f5; border: 2px solid #ab47bc; color: #4a148c; padding: 4px 8px;
            font-weight: bold; border-radius: 4px; cursor: pointer; font-size: 12px;
        }
        .tool-btn:hover { background: #e1bee7; }

        #game-chat-box { width: 240px; display: flex; flex-direction: column; }
        #game-chat { flex: 1; height: 350px; background: #fff; overflow-y: auto; padding: 6px; font-size: 12px; border: 2px solid #f06292; }

        #answer-overlay {
            position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%);
            background: linear-gradient(135deg, #ff4081, #aa00ff); color: #fff; padding: 18px 36px;
            font-size: 24px; font-weight: 900; font-family: 'DungGeunMo'; border: 4px solid #fff;
            border-radius: 16px; display: none; z-index: 100; text-align: center; white-space: nowrap;
        }

        #like-effect {
            position: absolute; top: 20%; left: 50%; transform: translateX(-50%);
            font-size: 48px; display: none; z-index: 101; animation: floatUp 1.2s ease-out forwards;
        }
        @keyframes floatUp {
            0% { opacity: 0; transform: translate(-50%, 20px) scale(0.5); }
            50% { opacity: 1; transform: translate(-50%, -20px) scale(1.3); }
            100% { opacity: 0; transform: translate(-50%, -60px) scale(1); }
        }
    </style>
</head>
<body>

    <div id="loading-overlay">
        <div class="loading-title">포키파티에 오신것을 진심으로 환영합니다 !</div>
        <div class="spinner"></div>
    </div>

    <!-- 🔐 로그인/회원가입 모달 -->
    <div id="auth-modal" class="modal">
        <div class="pixel-box modal-body">
            <div class="window-header">ポキパティ！！ 접속하기</div>
            
            <div id="login-form">
                <div class="form-group">
                    <span>아이디</span>
                    <input type="text" id="login-id" placeholder="아이디 입력...">
                </div>
                <div class="form-group">
                    <span>비밀번호</span>
                    <input type="password" id="login-pw" placeholder="비밀번호 입력...">
                </div>
                <button class="tool-btn" onclick="submitLogin()" style="background:#ff80ab; color:#fff; padding:8px; margin-top:6px;">로그인 💖</button>
                <p style="font-size:11px; text-align:center; color:#ad1457; cursor:pointer;" onclick="toggleAuthMode('register')">계정이 없으신가요? 회원가입하기</p>
            </div>

            <div id="register-form" style="display:none;">
                <div class="form-group">
                    <span>아이디 (3자 이상)</span>
                    <input type="text" id="reg-id" placeholder="아이디...">
                </div>
                <div class="form-group">
                    <span>비밀번호</span>
                    <input type="password" id="reg-pw" placeholder="비밀번호...">
                </div>
                <div class="form-group">
                    <span>닉네임 (2~8자)</span>
                    <input type="text" id="reg-nick" placeholder="닉네임...">
                </div>
                <button class="tool-btn" onclick="submitRegister()" style="background:#ba68c8; color:#fff; padding:8px; margin-top:6px;">회원가입 완료 ✨</button>
                <p style="font-size:11px; text-align:center; color:#ad1457; cursor:pointer;" onclick="toggleAuthMode('login')">이미 계정이 있으신가요? 로그인하기</p>
            </div>
        </div>
    </div>

    <!-- 🛍️ 상점 모달 -->
    <div id="shop-modal" class="modal" style="display:none;">
        <div class="pixel-box modal-body" style="width:480px;">
            <div class="window-header">
                <span>🛍️ 포키 커스터마이징 상점</span>
                <button class="tool-btn" onclick="closeShop()" style="font-size:10px;">X</button>
            </div>
            
            <div class="shop-tab-container">
                <button class="shop-tab-btn active" onclick="switchShopTab('titles')">🏅 칭호</button>
                <button class="shop-tab-btn" onclick="switchShopTab('badges')">🐱 아이콘</button>
                <button class="shop-tab-btn" onclick="switchShopTab('borders')">✨ 테두리</button>
            </div>

            <div id="shop-item-list" class="shop-item-list"></div>
        </div>
    </div>

    <!-- 🏰 로비 화면 -->
    <div id="lobby-screen">
        <div class="pixel-box window-header">
            <span>ポキパティ！！ (Poki Party) Lobby</span>
            <button class="tool-btn" onclick="location.reload()" style="font-size:10px;">로그아웃</button>
        </div>

        <div id="lobby-main">
            <div id="lobby-left">
                <div class="pixel-box" style="flex:1; display:flex; flex-direction:column;">
                    <div class="window-header" style="font-size:11px;">👥 접속자 목록</div>
                    <div id="user-list-box"></div>
                </div>
                <div class="pixel-box" id="my-profile">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span id="my-badge" style="font-size:18px;">🔰</span>
                        <span class="profile-badge" id="my-title">신입</span>
                    </div>
                    <div id="my-name-display" style="font-weight:900; font-size:15px; color:#880e4f;">포키가이</div>
                    <div style="font-size:11px; color:#ad1457; font-weight:bold;">
                        LV.<span id="my-level">1</span> | 포인트: <span id="my-points" style="color:#d81b60;">200</span> Pt
                    </div>
                    <button class="tool-btn" onclick="openShop()" style="margin-top:4px; background:#ba68c8; color:#fff;">🛍️ 상점 / 꾸미기</button>
                </div>
            </div>

            <div id="lobby-center">
                <div id="category-bar">
                    <button class="tab-btn" onclick="openCreateRoomModal()">➕ 방 만들기</button>
                    <button class="tab-btn" style="background:#ba68c8; border-color:#7b1fa2;" onclick="quickJoin()">⚡ 빠른 입장</button>
                </div>
                <div class="pixel-box" id="room-grid"></div>
            </div>
        </div>

        <div class="pixel-box" id="lobby-bottom">
            <div class="window-header" style="font-size:11px;">💬 로비 전체 채팅</div>
            <div id="lobby-chat"></div>
            <div style="display:flex; padding:4px; gap:4px; background:#fff;">
                <input type="text" id="lobby-chat-input" placeholder="로비 메시지 입력..." style="flex:1;" onkeypress="if(event.key==='Enter') sendLobbyChat()">
                <button class="tool-btn" onclick="sendLobbyChat()">전송</button>
            </div>
        </div>
    </div>

    <!-- 🏠 방 만들기 모달 -->
    <div id="create-room-modal" class="modal" style="display:none;">
        <div class="pixel-box modal-body">
            <div class="window-header">🏠 방 만들기</div>
            <div class="form-group">
                <span>방 제목</span>
                <input type="text" id="room-title-input" value="같이 즐겁게 그림 그려요!">
            </div>
            <div class="form-group">
                <span>비밀번호</span>
                <input type="password" id="room-pass-input" placeholder="선택 사항">
            </div>
            <div class="form-group">
                <span>최대 인원</span>
                <select id="room-max-select">
                    <option value="4">4명</option>
                    <option value="6" selected>6명</option>
                    <option value="8">8명</option>
                </select>
            </div>
            <div class="form-group">
                <span>총 라운드 수</span>
                <select id="room-rounds-select">
                    <option value="3" selected>3 라운드</option>
                    <option value="5">5 라운드</option>
                    <option value="10">10 라운드</option>
                </select>
            </div>
            <div class="form-group">
                <span>라운드 시간</span>
                <select id="room-time-select">
                    <option value="30">30초</option>
                    <option value="45">45초</option>
                    <option value="60" selected>60초</option>
                    <option value="90">90초</option>
                </select>
            </div>
            <div class="form-group">
                <span>주제 선택</span>
                <select id="room-cate-select">
                    <option value="all">🎨 전체 (대용량)</option>
                    <option value="game">🎮 게임 테마</option>
                    <option value="object">📦 사물 테마</option>
                    <option value="food">🍕 맛있는 음식</option>
                    <option value="anime">⚡ 애니메이션</option>
                    <option value="meme">🤣 밈 / 인터넷 용어</option>
                    <option value="lol">⚔️ 리그 오브 레전드</option>
                </select>
            </div>
            <div style="display:flex; gap:6px; margin-top:8px;">
                <button class="tool-btn" onclick="submitCreateRoom()" style="flex:1; background:#ff80ab; color:#fff;">확인</button>
                <button class="tool-btn" onclick="closeCreateRoomModal()" style="flex:1; background:#ccc;">취소</button>
            </div>
        </div>
    </div>

    <!-- 🎮 게임 플레이 화면 -->
    <div id="game-screen">
        <div class="pixel-box" id="game-header">
            <span style="font-weight:bold; font-size:14px; color:#880e4f;" id="game-room-title">방 제목</span>
            <span>ROUND <span id="round-disp" style="color:#d81b60; font-weight:900;">1</span>/<span id="max-round-disp">3</span></span>
            <div class="word-hint-box" id="word-disp">_ _ _</div>
            <span>⏰ <span id="timer-disp" style="color:#d81b60; font-weight:900;">60</span>s</span>
            <button class="tool-btn" onclick="confirmLeaveRoom()" style="background:#ef5350; color:#fff;">나가기</button>
        </div>

        <div id="game-main">
            <div class="pixel-box" id="game-players">
                <div>
                    <div class="window-header" style="font-size:11px;">PLAYERS</div>
                    <div id="game-player-list" style="margin-top:6px;"></div>
                </div>
            </div>

            <div id="canvas-container">
                <div style="position:relative;">
                    <canvas id="canvas" width="500" height="380"></canvas>
                    <div id="answer-overlay"><span id="overlay-text"></span></div>
                    <div id="like-effect">👍 +1</div>
                </div>
                
                <div id="toolbar">
                    <div class="palette" id="palette"></div>
                    <div style="display:flex; gap:4px; align-items:center;">
                        <button class="tool-btn" onclick="setPenWidth(2)">•</button>
                        <button class="tool-btn" onclick="setPenWidth(6)">●</button>
                        <button class="tool-btn" onclick="setPenWidth(14)">🔴</button>
                        <button class="tool-btn" onclick="fillBucket()">🪣</button>
                        <button class="tool-btn" onclick="useEraser()">🧹</button>
                        <button class="tool-btn" onclick="clearCanvas()" style="background:#ffebee;">❌</button>
                        <button class="tool-btn" onclick="sendLike()" style="background:#fff9c4; border-color:#fbc02d;">👍 개추</button>
                    </div>
                </div>
            </div>

            <div class="pixel-box" id="game-chat-box">
                <div class="window-header" style="font-size:11px;">CHAT & ANSWER</div>
                <div id="game-chat"></div>
                <div style="display:flex; padding:4px; gap:4px; background:#fff;">
                    <input type="text" id="game-chat-input" placeholder="정답 입력..." style="flex:1;" onkeypress="if(event.key==='Enter') sendGameChat()">
                    <button class="tool-btn" id="game-chat-btn" onclick="sendGameChat()">전송</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        const socket = io();
        let myAccount = null;
        let shopCatalog = {};
        let currentShopTab = 'titles';
        let isDrawer = false;
        let currentColor = '#000000';
        let currentWidth = 6;
        let isDrawing = false;
        let currentRoomList = [];

        function toggleAuthMode(mode) {
            document.getElementById('login-form').style.display = (mode === 'login') ? 'block' : 'none';
            document.getElementById('register-form').style.display = (mode === 'register') ? 'block' : 'none';
        }

        function submitRegister() {
            const username = document.getElementById('reg-id').value.trim();
            const password = document.getElementById('reg-pw').value.trim();
            const nickname = document.getElementById('reg-nick').value.trim();
            socket.emit('register', { username, password, nickname });
        }

        function submitLogin() {
            const username = document.getElementById('login-id').value.trim();
            const password = document.getElementById('login-pw').value.trim();
            socket.emit('login', { username, password });
        }

        socket.on('authError', (msg) => alert(msg));
        socket.on('authSuccess', (data) => {
            alert(data.message);
            toggleAuthMode('login');
        });

        socket.on('loginSuccess', (userData) => {
            myAccount = userData;
            shopCatalog = userData.shopCatalog;

            document.getElementById('auth-modal').style.display = 'none';

            const loadingOverlay = document.getElementById('loading-overlay');
            loadingOverlay.style.display = 'flex';

            setTimeout(() => {
                loadingOverlay.style.display = 'none';
                document.getElementById('lobby-screen').style.display = 'flex';
                updateProfileUI(userData);
            }, 1800);
        });

        function updateProfileUI(u) {
            myAccount = u;
            document.getElementById('my-name-display').innerText = u.nickname;
            document.getElementById('my-title').innerText = u.title;
            document.getElementById('my-badge').innerText = u.badge;
            document.getElementById('my-level').innerText = u.level;
            document.getElementById('my-points').innerText = u.points;

            const profileBox = document.getElementById('my-profile');
            if (u.borderStyle) profileBox.style = u.borderStyle + " padding:10px; background:#f3e5f5;";
        }

        socket.on('profileUpdated', (updatedUser) => {
            updateProfileUI(updatedUser);
            renderShopItems();
        });

        function openShop() {
            renderShopItems();
            document.getElementById('shop-modal').style.display = 'flex';
        }

        function closeShop() {
            document.getElementById('shop-modal').style.display = 'none';
        }

        function switchShopTab(tab) {
            currentShopTab = tab;
            document.querySelectorAll('.shop-tab-btn').forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');
            renderShopItems();
        }

        function renderShopItems() {
            const container = document.getElementById('shop-item-list');
            container.innerHTML = '';

            const items = shopCatalog[currentShopTab] || [];
            items.forEach(item => {
                const isOwned = myAccount.inventory.includes(item.id);
                const card = document.createElement('div');
                card.className = 'shop-item-card';

                let reqInfo = item.reqLevel ? \` [LV.\${item.reqLevel} 이상]\` : '';

                let actionBtn = '';
                if (isOwned) {
                    actionBtn = \`<button class="tool-btn" onclick="equipItem('\${currentShopTab}', '\${item.id}')" style="background:#81c784; color:#fff;">장착</button>\`;
                } else {
                    actionBtn = \`<button class="tool-btn" onclick="buyItem('\${currentShopTab}', '\${item.id}')" style="background:#ff80ab; color:#fff;">구매 (\${item.price}pt)</button>\`;
                }

                card.innerHTML = \`
                    <div>
                        <div style="font-weight:bold; font-size:13px; color:#4a148c;">\${item.name}\${reqInfo}</div>
                    </div>
                    \${actionBtn}
                \`;
                container.appendChild(card);
            });
        }

        function buyItem(type, id) { socket.emit('buyItem', { itemType: type, itemId: id }); }
        function equipItem(type, id) { socket.emit('equipItem', { itemType: type, itemId: id }); }

        socket.on('shopError', (msg) => alert(msg));
        socket.on('shopSuccess', (data) => {
            alert(data.message);
            updateProfileUI(data.user);
            renderShopItems();
        });

        const canvas = document.getElementById('canvas');
        const ctx = canvas.getContext('2d');
        const colors = ['#000000', '#ffffff', '#ff4081', '#aa00ff', '#3d5aff', '#00e5ff', '#00e676', '#ffea00', '#ff9100', '#ff3d00'];
        const palette = document.getElementById('palette');
        colors.forEach(c => {
            const dot = document.createElement('div');
            dot.className = 'color-dot';
            dot.style.background = c;
            dot.onclick = () => currentColor = c;
            palette.appendChild(dot);
        });

        canvas.addEventListener('mousedown', (e) => {
            if (!isDrawer) return;
            isDrawing = true;
            const pos = getCanvasPos(e);
            ctx.beginPath(); ctx.moveTo(pos.x, pos.y);
            socket.emit('draw', { type: 'start', x: pos.x, y: pos.y, color: currentColor, width: currentWidth });
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!isDrawing || !isDrawer) return;
            const pos = getCanvasPos(e);
            ctx.lineTo(pos.x, pos.y); ctx.strokeStyle = currentColor; ctx.lineWidth = currentWidth; ctx.lineCap = 'round'; ctx.stroke();
            socket.emit('draw', { type: 'draw', x: pos.x, y: pos.y, color: currentColor, width: currentWidth });
        });

        canvas.addEventListener('mouseup', () => isDrawing = false);
        canvas.addEventListener('mouseleave', () => isDrawing = false);

        function getCanvasPos(e) {
            const rect = canvas.getBoundingClientRect();
            return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        }

        function setPenWidth(w) { currentWidth = w; }
        function useEraser() { currentColor = '#ffffff'; }
        function clearCanvas() { if (isDrawer) socket.emit('clearCanvas'); }
        function fillBucket() {
            if (!isDrawer) return;
            ctx.fillStyle = currentColor; ctx.fillRect(0, 0, canvas.width, canvas.height);
            socket.emit('fillCanvas', currentColor);
        }

        function sendLike() {
            socket.emit('sendLike');
        }

        socket.on('likeEffect', (d) => {
            const effect = document.getElementById('like-effect');
            effect.innerText = \`👍 \${d.sender}\`;
            effect.style.display = 'block';
            setTimeout(() => { effect.style.display = 'none'; }, 1200);
        });

        socket.on('draw', (d) => {
            if (d.type === 'start') { ctx.beginPath(); ctx.moveTo(d.x, d.y); }
            else { ctx.lineTo(d.x, d.y); ctx.strokeStyle = d.color; ctx.lineWidth = d.width; ctx.lineCap = 'round'; ctx.stroke(); }
        });
        socket.on('clearCanvas', () => ctx.clearRect(0, 0, canvas.width, canvas.height));
        socket.on('fillCanvas', (c) => { ctx.fillStyle = c; ctx.fillRect(0, 0, canvas.width, canvas.height); });

        socket.on('updateLobbyUsers', (users) => {
            const box = document.getElementById('user-list-box');
            box.innerHTML = '';
            users.forEach(u => {
                const item = document.createElement('div');
                item.className = 'user-item';
                item.style = u.borderStyle || '';
                item.innerText = \`[\${u.title || '포키'}] \${u.badge || '🌸'} \${u.nickname} (LV.\${u.level || 1})\`;
                box.appendChild(item);
            });
        });

        socket.on('updateRoomList', (roomList) => {
            currentRoomList = roomList;
            const grid = document.getElementById('room-grid');
            grid.innerHTML = '';
            roomList.forEach(r => {
                const card = document.createElement('div');
                card.className = 'room-card';
                card.onclick = () => joinRoomById(r.id, r.isLocked);
                card.innerHTML = \`
                    <div style="font-weight:900; font-size:14px; display:flex; justify-content:space-between;">
                        <span>#\${r.roomNum} \${r.title}</span><span>\${r.isLocked ? '🔒' : '🔓'}</span>
                    </div>
                    <div style="font-size:11px; color:#ad1457;">[주제: \${r.category.toUpperCase()}] | 인원: \${r.currentPlayers}/\${r.maxPlayers}</div>
                \`;
                grid.appendChild(card);
            });
        });

        function sendLobbyChat() {
            const input = document.getElementById('lobby-chat-input');
            if (input.value.trim()) { socket.emit('lobbyChat', input.value.trim()); input.value = ''; }
        }

        socket.on('lobbyChat', (d) => {
            const box = document.getElementById('lobby-chat');
            const msg = document.createElement('div');
            msg.innerText = \`[\${d.sender}]: \${d.text}\`;
            box.appendChild(msg); box.scrollTop = box.scrollHeight;
        });

        function openCreateRoomModal() { document.getElementById('create-room-modal').style.display = 'flex'; }
        function closeCreateRoomModal() { document.getElementById('create-room-modal').style.display = 'none'; }

        function submitCreateRoom() {
            const title = document.getElementById('room-title-input').value.trim();
            const password = document.getElementById('room-pass-input').value.trim();
            const maxPlayers = document.getElementById('room-max-select').value;
            const maxRounds = document.getElementById('room-rounds-select').value;
            const roundTime = document.getElementById('room-time-select').value;
            const category = document.getElementById('room-cate-select').value;
            socket.emit('createRoom', { title, password, maxPlayers, maxRounds, roundTime, category });
            closeCreateRoomModal();
        }

        socket.on('roomCreated', ({ roomId, password }) => socket.emit('joinRoom', { roomId, password }));

        function joinRoomById(roomId, isLocked) {
            let password = isLocked ? prompt('비밀번호 입력:') : '';
            if (isLocked && password === null) return;
            socket.emit('joinRoom', { roomId, password });
        }

        function quickJoin() {
            const available = currentRoomList.find(r => !r.isLocked && r.currentPlayers < r.maxPlayers);
            if (available) socket.emit('joinRoom', { roomId: available.id, password: '' });
            else alert('입장 가능한 공개 방이 없습니다.');
        }

        socket.on('roomJoined', (room) => {
            document.getElementById('lobby-screen').style.display = 'none';
            document.getElementById('game-screen').style.display = 'flex';
            document.getElementById('game-room-title').innerText = room.title;
        });

        function confirmLeaveRoom() {
            if (confirm("퇴장하시겠습니까?")) {
                socket.emit('leaveRoom');
                document.getElementById('game-screen').style.display = 'none';
                document.getElementById('lobby-screen').style.display = 'flex';
            }
        }

        socket.on('updatePlayers', (players) => {
            const list = document.getElementById('game-player-list');
            list.innerHTML = '';
            players.forEach(p => {
                const card = document.createElement('div');
                card.className = 'player-card';
                card.style = p.borderStyle || '';
                card.innerHTML = \`<span>\${p.badge || ''} \${p.name}</span><span style="color:#d81b60;">\${p.score}pt</span>\`;
                list.appendChild(card);
            });
        });

        socket.on('turnStart', (data) => {
            isDrawer = data.isDrawer;
            document.getElementById('word-disp').innerText = data.word;
            document.getElementById('round-disp').innerText = data.round;
            document.getElementById('max-round-disp').innerText = data.maxRounds;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const overlay = document.getElementById('answer-overlay');
            if (isDrawer) {
                document.getElementById('overlay-text').innerHTML = "🎨 출제자입니다!<br>그림을 그려주세요!";
                overlay.style.display = 'block'; setTimeout(() => overlay.style.display = 'none', 2000);
            }
        });

        socket.on('timerUpdate', (t) => document.getElementById('timer-disp').innerText = t);
        socket.on('correctAnswerOverlay', (d) => {
            const overlay = document.getElementById('answer-overlay');
            document.getElementById('overlay-text').innerText = \`🎉 \${d.winner}님 정답!\`;
            overlay.style.display = 'block'; setTimeout(() => overlay.style.display = 'none', 1800);
        });

        function sendGameChat() {
            const input = document.getElementById('game-chat-input');
            if (input.value.trim()) { socket.emit('chatMessage', input.value.trim()); input.value = ''; }
        }

        socket.on('chatMessage', (d) => {
            const box = document.getElementById('game-chat');
            const msg = document.createElement('div');
            msg.innerText = \`[\${d.sender}]: \${d.text}\`;
            box.appendChild(msg); box.scrollTop = box.scrollHeight;
        });

        socket.on('gameOver', (rankings) => alert(\`🏆 게임 종료! 1위: \${rankings[0].name} (\${rankings[0].score}점)\`));
    </script>
</body>
</html>`;
}

server.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(` Poki Party (ポキパティ！！) 서버 가동 성공!`);
    console.log(` 점수 차등제 & 유저 DB 개인 포인트 연동 완료!`);
    console.log(`=================================================`);
});
