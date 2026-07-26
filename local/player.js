const socket = io();
const params = new URLSearchParams(location.search);
let roomCode = params.get('room')?.toUpperCase() || '';
let token = localStorage.getItem('buzzer_local_token');
let displayName;
let room;
let previousScore = 0;
let namesData;
let previousState;
let previousWinner;
let pingTimer;
const el = id => document.getElementById(id);
el('room').value = roomCode;

fetch('/assets/data/names.json')
    .then(response => response.json())
    .then(data => { namesData = data; })
    .catch(() => { namesData = { modifiers: [''], characters: ['Player'] }; });

tryAutoResume();

el('room').addEventListener('input', event => {
    event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

el('checkRoomButton').onclick = () => {
    roomCode = el('room').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(roomCode)) return alert('ルームコードは6文字です');
    el('roomCodeSection').classList.add('hidden');
    el('nameSection').classList.remove('hidden');
    generateNameOptions();
};

function generateNameOptions() {
    if (!namesData) {
        setTimeout(generateNameOptions, 100);
        return;
    }
    const names = Array.from({ length: 5 }, () => {
        const modifier = namesData.modifiers[Math.floor(Math.random() * namesData.modifiers.length)];
        const character = namesData.characters[Math.floor(Math.random() * namesData.characters.length)];
        return `${modifier}${character}`;
    });
    el('nameOptions').innerHTML = names.map(name =>
        `<button class="name-option" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join('');
    el('nameOptions').querySelectorAll('.name-option').forEach(button => {
        button.onclick = () => joinAs(button.dataset.name);
    });
}

el('shuffleNamesButton').onclick = generateNameOptions;

function joinAs(name) {
    displayName = name;
    socket.emit('joinRoom', { roomCode, token, displayName }, result => {
        if (!result.success) return alert('ルームが見つかりません');
        token = result.token;
        localStorage.setItem('buzzer_local_token', token);
        localStorage.setItem('buzzer_local_name', result.player.displayName);
        localStorage.setItem('buzzer_local_room', roomCode);
        displayName = result.player.displayName;
        el('join').classList.add('hidden');
        el('play').classList.remove('hidden');
        el('me').textContent = displayName;
        render(result.room);
        startPing();
    });
}

function tryAutoResume() {
    const savedName = localStorage.getItem('buzzer_local_name');
    const savedRoom = localStorage.getItem('buzzer_local_room');
    if (!token || !savedName || !savedRoom) return;
    if (roomCode && roomCode !== savedRoom) return;
    roomCode = savedRoom;
    displayName = savedName;
    el('room').value = roomCode;
    socket.emit('joinRoom', { roomCode, token, displayName }, result => {
        if (!result.success) return;
        el('join').classList.add('hidden');
        el('play').classList.remove('hidden');
        el('me').textContent = result.player.displayName;
        render(result.room);
        startPing();
    });
}

function startPing() {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => socket.emit('ping', { roomCode, token, sentAt: Date.now() }, () => {}), 3000);
}

socket.on('connect', () => {
    const savedName = localStorage.getItem('buzzer_local_name');
    const savedRoom = localStorage.getItem('buzzer_local_room');
    if (!token || !savedName || !savedRoom || el('play').classList.contains('hidden')) return;
    if (roomCode && roomCode !== savedRoom) return;
    roomCode = savedRoom;
    displayName = savedName;
    socket.emit('joinRoom', { roomCode, token, displayName }, result => {
        if (result.success) {
            el('join').classList.add('hidden');
            el('play').classList.remove('hidden');
            el('me').textContent = result.player.displayName;
            render(result.room);
            startPing();
        }
    });
});

socket.on('disconnect', () => {
    if (!el('play').classList.contains('hidden')) el('status').textContent = '接続が切れました。再接続中...';
});

el('exit').onclick = () => {
    if (confirm('退出しますか？')) {
        socket.disconnect();
        location.href = 'index.html';
    }
};

function playSound(name) {
    const sound = new Audio(`/assets/sounds/${name}.mp3`);
    sound.currentTime = 0;
    sound.play().catch(() => {});
}

function showResult(correct) {
    el('resultIcon').textContent = correct ? '⭕' : '❌';
    el('resultText').textContent = correct ? '正解！' : '不正解...';
    el('resultText').style.color = correct ? 'var(--accent-green)' : 'var(--accent-red)';
    el('resultOverlay').classList.remove('hidden');
    setTimeout(() => el('resultOverlay').classList.add('hidden'), 1500);
}

el('buzzer').onclick = () => socket.emit('buzz', { roomCode, token }, () => {});
document.querySelectorAll('[data-vote]').forEach(button => button.onclick = () => socket.emit('supportVote', {
    roomCode, token, choice: button.dataset.vote
}, result => {
    if (!result.success) {
        el('voteStatus').textContent = '投票を受け付けられませんでした';
        return;
    }
    document.querySelectorAll('[data-vote]').forEach(voteButton => { voteButton.disabled = true; });
    el('voteStatus').textContent = button.dataset.vote === 'support'
        ? '○を選びました。判定を待っています。'
        : '×を選びました。判定を待っています。';
}));
socket.on('roomUpdate', render);

function render(nextRoom) {
    if (!nextRoom || !token) return;
    room = nextRoom;
    const me = room.players.find(player => player.playerToken === token);
    if (!me) return;
    el('score').textContent = me.score;
    const teamMode = room.rules?.teamMode;
    const score = scoreOf(me);
    el('score').textContent = score;
    el('myIndividualScore').textContent = score;
    renderTeamHeader(me, room.teams || {}, teamMode);
    if (previousState === 'LOCKED' && previousWinner === token && !room.winner) {
        const correct = score > previousScore;
        showResult(correct);
        playSound(correct ? 'correct' : 'wrong');
    }
    if (previousState === 'OPEN' && room.roomState === 'LOCKED' && room.winner) playSound('buzz');
    el('round').textContent = `第${room.roundNumber}問`;
    const winner = room.winner;
    const canBuzz = room.roomState === 'OPEN' && me.playerState === 'READY';
    el('buzzer').disabled = !canBuzz;
    el('buzzer').textContent = canBuzz ? 'PUSH!' : (me.playerState === 'LOCKED_PENALTY_THIS' ? '🚫' : 'WAIT');
    el('status').className = 'local-status';
    el('status').textContent = room.roomState === 'FINISHED' ? 'お疲れ様でした！' : room.roomState === 'OPEN' ? (canBuzz ? '🔥 早押しスタート！' : '回答できません') :
        winner ? (winner.playerToken === token ? '先着！判定を待っています' : '他の人が先着しました') :
        (room.pending ? '早押し判定中…' : '待機中');
    if (canBuzz) el('status').classList.add('open');
    if (winner?.playerToken === token) el('status').classList.add('winner');
    if (me.playerState === 'LOCKED_PENALTY_THIS') el('status').classList.add('locked');
    el('buzzer').classList.toggle('pressed', me.playerState === 'PRESSED');
    el('buzzer').classList.toggle('winner', winner?.playerToken === token);
    el('buzzer').classList.toggle('locked', !canBuzz && !winner);
    el('buzzer').classList.toggle('hidden', room.roomState === 'FINISHED');
    el('finishText').classList.toggle('hidden', room.roomState !== 'FINISHED');
    el('play').classList.toggle('game-finished', room.roomState === 'FINISHED');
    const vote = room.supportVotes?.[token];
    const isPenaltyLocked = me.playerState === 'LOCKED_PENALTY_THIS' || me.playerState === 'LOCKED_PENALTY_NEXT';
    const canVote = room.rules.answerRule === 'support' && room.roomState === 'LOCKED' && winner && winner.playerToken !== token && !isPenaltyLocked;
    el('vote').classList.toggle('hidden', !canVote);
    if (canVote) {
        el('answerer').textContent = winner.displayName;
        el('voteStatus').textContent = vote ? (vote.choice === 'support' ? '○を選びました' : '×を選びました') : '正解なら○に+1pt。不正解なら○を選んだ人は当問ロックです。';
        document.querySelectorAll('[data-vote]').forEach(button => button.disabled = Boolean(vote));
    }
    renderRankings(room.players || [], room.teams || {}, room.rules || {});
    previousScore = scoreOf(me);
    previousState = room.roomState;
    previousWinner = winner?.playerToken;
}

function renderTeamHeader(me, teams, teamMode) {
    const team = me.teamId ? teams[me.teamId] : null;
    const showTeam = Boolean(teamMode && team);
    el('teamScoreBlock').classList.toggle('hidden', !showTeam);
    el('individualScoreBlock').classList.toggle('hidden', !showTeam);
    el('myTeamBadge').classList.toggle('hidden', !showTeam);
    if (!showTeam) return;
    const color = team.color || 'var(--accent-cyan)';
    el('teamScore').textContent = team.score || 0;
    el('myTeamName').textContent = team.teamName || 'チーム';
    el('myTeamName').style.color = color;
    el('myTeamBadge').textContent = team.teamName || 'チーム';
    el('myTeamBadge').style.background = color;
    el('teamScoreBlock').style.border = `1px solid ${color}`;
}

function renderRankings(players, teams, rules) {
    el('ranking').innerHTML = [...players].sort((a, b) => scoreOf(b) - scoreOf(a)).slice(0, 5).map((player, index) => {
        const medal = index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : '';
        return `<div class="ranking-item ${player.playerToken === token ? 'highlight' : ''}"><span class="ranking-rank ${medal}">${index + 1}</span><span class="ranking-name">${escapeHtml(player.displayName)}</span><span class="ranking-score">${scoreOf(player)}pt</span></div>`;
    }).join('');
    const teamArray = Object.values(teams || {});
    if (rules.teamMode && teamArray.length > 0) {
        const playerMap = Object.fromEntries(players.map(player => [player.playerToken, player]));
        el('teamRanking').innerHTML = teamArray.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5).map((team, index) => {
            const memberTokens = team.members?.length ? team.members : players.filter(player => player.teamId === team.teamId).map(player => player.playerToken);
            const chips = memberTokens.map(memberToken => playerMap[memberToken]).filter(Boolean).map(player =>
                `<span class="team-member-chip">${escapeHtml(player.displayName)} ${scoreOf(player)}pt</span>`).join('');
            return `
                <div class="ranking-item team-ranking-item">
                    <div class="team-ranking-header" style="--team-color: ${team.color || 'var(--accent-cyan)'};">
                        <span class="ranking-rank">${index + 1}</span>
                        <span class="team-name">${escapeHtml(team.teamName || 'チーム')}</span>
                        <span class="team-score">${team.score || 0}pt</span>
                    </div>
                    <div class="team-member-chips">${chips || '<span class="text-muted">メンバーなし</span>'}</div>
                </div>
            `;
        }).join('');
    } else {
        el('teamRanking').innerHTML = `<div class="text-muted">${rules.teamMode ? 'チーム未作成です' : 'チーム戦なし'}</div>`;
    }
}

function scoreOf(player) { return player.individualScore !== undefined ? player.individualScore : (player.score || 0); }
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
