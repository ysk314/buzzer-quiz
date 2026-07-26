const socket = io();
let roomCode;
let pin;
let room;
let previousState;
let judgementTimeoutId = null;
let pendingRules = {
    answerRule: 'classic',
    wrongPoints: 0,
    allowNegative: false,
    penaltyType: 'thisRound',
    teamMode: false,
    numTeams: 2
};

const sounds = {};
const el = id => document.getElementById(id);

function playSound(name) {
    sounds[name] ||= new Audio(`/assets/sounds/${name}.mp3`);
    sounds[name].currentTime = 0;
    sounds[name].play().catch(() => {});
}

function showSetupSection(sectionId) {
    ['choiceSection', 'resumeSection', 'roomCreatedSection'].forEach(id => {
        el(id)?.classList.toggle('hidden', id !== sectionId);
    });
}

el('createRoomBtn').onclick = () => socket.emit('createRoom', result => {
    roomCode = result.roomCode;
    pin = result.pin;
    room = null;
    previousState = null;
    const joinUrl = `${result.lanUrl}player.html?room=${roomCode}`;
    el('displayRoomCode').textContent = roomCode;
    el('displayPin').textContent = pin;
    el('shareUrl').value = joinUrl;
    el('qrCode').src = `qr.svg?url=${encodeURIComponent(joinUrl)}`;
    showSetupSection('roomCreatedSection');
    renderSettings(pendingRules);
});

el('showResumeBtn').onclick = () => showSetupSection('resumeSection');
el('backToChoiceFromResume').onclick = () => showSetupSection('choiceSection');
el('resumeRoomCode').addEventListener('input', event => {
    event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
el('resumePin').addEventListener('input', event => {
    event.target.value = event.target.value.replace(/\D/g, '');
});
el('resumeRoomBtn').onclick = () => {
    const code = el('resumeRoomCode').value.trim().toUpperCase();
    const resumePin = el('resumePin').value.trim();
    if (!/^[A-Z0-9]{6}$/.test(code) || !/^\d{4}$/.test(resumePin)) {
        alert('ルームコード6文字とホストPIN4桁を入力してください');
        return;
    }
    roomCode = code;
    pin = resumePin;
    enterHostMode({ applyPendingRules: false });
};

el('autoJoinBtn').onclick = () => enterHostMode({ applyPendingRules: true });
el('backToChoiceFromCreated').onclick = () => showSetupSection('choiceSection');
el('backToSetupBtn').onclick = () => {
    el('mainScreen').classList.add('hidden');
    el('setupScreen').classList.remove('hidden');
    showSetupSection('choiceSection');
};
el('copyUrlBtn').onclick = async () => {
    await navigator.clipboard?.writeText(el('shareUrl').value);
};

el('settingsToggle').onclick = openSettings;
el('settingsTogglePre').onclick = openSettings;
el('closeSettings').onclick = closeSettings;
el('settingsOverlay').onclick = event => {
    if (event.target === el('settingsOverlay')) closeSettings();
};

function enterHostMode({ applyPendingRules } = { applyPendingRules: true }) {
    const rulesToApply = { ...pendingRules };
    socket.emit('hostAuth', { roomCode, pin }, auth => {
        if (!auth.success) return alert('ホスト認証に失敗しました');
        el('setupScreen').classList.add('hidden');
        el('mainScreen').classList.remove('hidden');
        el('headerRoomCode').textContent = roomCode;
        el('headerPin').textContent = pin;
        render(auth.room);
        if (applyPendingRules) {
            socket.emit('updateRules', { roomCode, rules: rulesToApply }, result => {
                if (!result.success) alert('ルール設定を反映できませんでした');
            });
        }
    });
}

function openSettings() {
    el('settingsOverlay').classList.add('active');
}

function closeSettings() {
    el('settingsOverlay').classList.remove('active');
}

function emit(event, payload = {}) {
    socket.emit(event, { roomCode, ...payload }, result => {
        if (!result?.success) alert('操作を受け付けられませんでした');
    });
}

el('openBtn').onclick = () => {
    playSound('open');
    emit('openBuzz', { clearPenalties: room.roomState === 'OPEN' });
};
el('correctBtn').onclick = () => {
    showJudgement('correct');
    playSound('correct');
    emit('judge', { result: 'correct' });
};
el('wrongBtn').onclick = () => {
    showJudgement('wrong');
    playSound('wrong');
    emit('judge', { result: 'wrong' });
    setTimeout(() => emit('openBuzz', { clearPenalties: false }), 250);
};
el('nextBtn').onclick = () => {
    playSound('open');
    emit('nextRound');
};
el('undoBtn').onclick = () => emit('undo');
el('finishGameBtn').onclick = () => {
    if (confirm('クイズを終了して結果発表にしますか？')) {
        playSound('end');
        emit('finishGame');
    }
};

document.querySelectorAll('.setting-option').forEach(button => {
    button.onclick = () => {
        const value = parseSettingValue(button.dataset.value);
        pendingRules = { ...pendingRules, [button.dataset.setting]: value };
        renderSettings(pendingRules);
        if (room) emit('updateRules', { rules: { [button.dataset.setting]: value } });
    };
});

el('teamModeToggle').onchange = event => {
    const teamMode = event.target.checked;
    pendingRules = { ...pendingRules, teamMode };
    renderSettings(pendingRules);
    if (room) emit('updateRules', { rules: { teamMode } });
};

el('numTeamsInput').onchange = event => {
    const numTeams = normalizeTeamCount(event.target.value, room?.players?.length || 0);
    pendingRules = { ...pendingRules, numTeams };
    event.target.value = numTeams;
    updateTeamHint(room?.players?.length || 0);
    if (room) emit('updateRules', { rules: { numTeams } });
};

el('createTeamsBtn').onclick = () => {
    const playerCount = room?.players?.length || 0;
    if (playerCount < 4) return alert('チーム作成には4人以上の参加者が必要です');
    const numTeams = normalizeTeamCount(el('numTeamsInput').value, playerCount);
    socket.emit('createTeams', { roomCode, numTeams }, result => {
        if (!result?.success) {
            const message = result?.error === 'NOT_ENOUGH_PLAYERS'
                ? 'チーム作成には4人以上の参加者が必要です'
                : 'チーム作成に失敗しました';
            alert(message);
        }
    });
};

socket.on('roomUpdate', render);

function render(nextRoom) {
    room = nextRoom;
    const players = room.players || [];
    const hasWinner = Boolean(room.winner);
    const hasPenalty = players.some(player =>
        player.playerState === 'LOCKED_PENALTY_THIS' || player.playerState === 'LOCKED_PENALTY_NEXT'
    );

    if (previousState === 'OPEN' && room.roomState === 'LOCKED' && hasWinner) playSound('buzz');
    if (previousState !== 'FINISHED' && room.roomState === 'FINISHED') playSound('end');
    previousState = room.roomState;
    pendingRules = { ...pendingRules, ...(room.rules || {}) };

    el('roundNumber').textContent = room.roundNumber;
    el('roundNumberDisplay').textContent = room.roundNumber;
    el('playerCount').textContent = players.length;
    el('playerListCount').textContent = players.length;

    renderBadge(room.roomState);
    renderMainState(players, hasWinner, hasPenalty);
    renderPlayers(players);
    renderSettings(room.rules || {});
}

function renderBadge(state) {
    const badge = el('roomStateBadge');
    badge.className = 'badge';
    if (state === 'OPEN') badge.classList.add('badge-open');
    else if (state === 'LOCKED' || state === 'FINISHED') badge.classList.add('badge-locked');
    else badge.classList.add('badge-waiting');
    badge.textContent = state;
}

function renderMainState(players, hasWinner, hasPenalty) {
    const finished = room.roomState === 'FINISHED';
    el('controlSection').classList.toggle('hidden', finished);
    el('finalRankingSection').classList.toggle('hidden', !finished);
    if (finished) {
        renderFinalRanking(players);
        return;
    }

    const waitingDisplay = el('waitingDisplay');
    const winnerDisplay = el('winnerDisplay');
    const judgeButtons = el('judgeButtons');
    const voteCount = el('supportVoteCount');
    const judgementDisplay = el('judgementDisplay');
    const openBtn = el('openBtn');
    const nextBtn = el('nextBtn');

    const isFirstWait = room.roundNumber === 1 && room.roomState === 'WAITING' && !room.canUndo;
    const afterCorrect = room.roomState === 'WAITING' && room.lastJudgement === 'correct';
    const afterWrong = room.roomState === 'LOCKED' && room.lastJudgement === 'wrong';
    const showJudge = room.roomState === 'LOCKED' && hasWinner;
    const showOpen = !showJudge && (room.roomState === 'WAITING' || room.roomState === 'LOCKED' || (room.roomState === 'OPEN' && hasPenalty)) && !afterCorrect;
    const showNext = afterCorrect || afterWrong;

    winnerDisplay.classList.toggle('hidden', !showJudge);
    judgeButtons.classList.toggle('hidden', !showJudge);
    openBtn.classList.toggle('hidden', !showOpen);
    nextBtn.classList.toggle('hidden', !showNext);
    voteCount.classList.toggle('hidden', !(room.rules?.answerRule === 'support' && showJudge));

    if (!judgementTimeoutId && !afterCorrect && !afterWrong) {
        judgementDisplay.classList.add('hidden');
    }

    if (showJudge) {
        el('winnerName').textContent = room.winner.displayName;
        el('reactionTime').textContent = room.winner.reactionTime || 0;
        const votes = Object.values(room.supportVotes || {});
        const supported = votes.filter(vote => vote.choice === 'support').length;
        voteCount.textContent = `支持投票: ○ ${supported}人 / 回答済み ${votes.length}人`;
    }

    if (isFirstWait) {
        openBtn.textContent = '🚀 クイズスタート！';
        waitingDisplay.innerHTML = '<p class="text-secondary" style="font-size: 1.2rem;">参加者が揃ったら、「クイズスタート」をタップ！</p>';
        waitingDisplay.classList.remove('hidden');
    } else if (room.roomState === 'OPEN') {
        openBtn.textContent = hasPenalty ? '🔓 全員ペナルティ解除' : '🔓 回答再開';
        waitingDisplay.innerHTML = '<p class="text-success" style="font-size: 1.2rem;">🔹 回答受付中... （ボタンを連打できます！）</p>';
        waitingDisplay.classList.toggle('hidden', !hasPenalty);
    } else if (afterCorrect) {
        waitingDisplay.innerHTML = '<p class="text-accent" style="font-size: 1.2rem;">正解！「次の問題へ」を押してください</p>';
        waitingDisplay.classList.remove('hidden');
    } else if (afterWrong) {
        openBtn.textContent = hasPenalty ? '🔓 全員ペナルティ解除' : '🔓 回答再開';
        waitingDisplay.innerHTML = hasPenalty
            ? '<p class="text-secondary" style="font-size: 1.2rem;">「回答再開」でロック対象以外の回答を再開します</p>'
            : '<p class="text-secondary" style="font-size: 1.2rem;">「回答再開」または「次の問題へ」を選んでください</p>';
        waitingDisplay.classList.remove('hidden');
    } else {
        openBtn.textContent = hasPenalty ? '🔓 全員ペナルティ解除' : '🔓 回答再開';
        waitingDisplay.classList.toggle('hidden', showJudge);
    }

    el('undoBtn').classList.toggle('hidden', !room.canUndo);
    el('finishGameBtn').classList.remove('hidden');
}

function showJudgement(result) {
    const judgementDisplay = el('judgementDisplay');
    const judgementIcon = el('judgementIcon');
    judgementIcon.textContent = result === 'correct' ? '◯' : '×';
    judgementIcon.style.color = result === 'correct' ? 'var(--accent-green)' : 'var(--accent-red)';
    judgementDisplay.classList.remove('hidden');
    el('winnerDisplay').classList.add('hidden');
    el('judgeButtons').classList.add('hidden');
    el('openBtn').classList.add('hidden');
    el('nextBtn').classList.add('hidden');
    if (judgementTimeoutId) clearTimeout(judgementTimeoutId);
    judgementTimeoutId = setTimeout(() => {
        judgementTimeoutId = null;
        judgementDisplay.classList.add('hidden');
        render(room);
    }, result === 'correct' ? 2000 : 1500);
}

function renderPlayers(players) {
    if (!players.length) {
        el('playerList').innerHTML = '<p class="text-muted">参加者を待っています...</p>';
        return;
    }
    if (room.rules?.teamMode && Object.keys(room.teams || {}).length) {
        el('playerList').innerHTML = renderTeamGroups(players, room.teams);
        return;
    }
    el('playerList').innerHTML = [...players].sort((a, b) => scoreOf(b) - scoreOf(a)).map(player => {
        const locked = player.playerState === 'LOCKED_PENALTY_THIS' || player.playerState === 'LOCKED_PENALTY_NEXT';
        const offline = player.connectionStatus === 'offline';
        return `
            <div class="player-item ${locked ? 'locked' : ''} ${offline ? 'offline' : ''}">
                <span class="player-name">${escapeHtml(player.displayName)}${locked ? ' 🚫' : ''}</span>
                <span class="player-meta">
                    <span class="network-pill ${networkClass(player)}">${networkLabel(player)}</span>
                    <span class="player-score">${scoreOf(player)}pt</span>
                </span>
            </div>
        `;
    }).join('');
}

function renderTeamGroups(players, teams) {
    const playersByToken = Object.fromEntries(players.map(player => [player.playerToken, player]));
    const assigned = new Set();
    const groups = Object.values(teams).sort((a, b) => (b.score || 0) - (a.score || 0)).map(team => {
        const members = (team.members || [])
            .map(token => playersByToken[token])
            .filter(Boolean)
            .sort((a, b) => scoreOf(b) - scoreOf(a));
        members.forEach(player => assigned.add(player.playerToken));
        return `
            <details class="team-group" open>
                <summary class="team-summary" style="--team-color: ${team.color || 'var(--accent-cyan)'};">
                    <span class="team-name">${escapeHtml(team.teamName || 'チーム')}</span>
                    <span class="team-meta">${members.length}人</span>
                    <span class="team-score">${team.score || 0}pt</span>
                </summary>
                <div class="team-members">
                    ${members.map(player => `
                        <div class="team-member ${player.connectionStatus === 'offline' ? 'offline' : ''}">
                            <span>${escapeHtml(player.displayName)}</span>
                            <span class="player-meta">
                                <span class="network-pill ${networkClass(player)}">${networkLabel(player)}</span>
                                <span>${scoreOf(player)}pt</span>
                            </span>
                        </div>
                    `).join('') || '<div class="text-muted">メンバーなし</div>'}
                </div>
            </details>
        `;
    });
    const unassigned = players.filter(player => !assigned.has(player.playerToken));
    if (unassigned.length) {
        groups.push(`
            <details class="team-group">
                <summary class="team-summary" style="--team-color: var(--accent-red);">
                    <span class="team-name">未所属</span>
                    <span class="team-meta">${unassigned.length}人</span>
                    <span class="team-score">-</span>
                </summary>
                <div class="team-members">
                    ${unassigned.map(player => `
                        <div class="team-member">
                            <span>${escapeHtml(player.displayName)}</span>
                            <span class="player-meta">
                                <span class="network-pill ${networkClass(player)}">${networkLabel(player)}</span>
                                <span>${scoreOf(player)}pt</span>
                            </span>
                        </div>
                    `).join('')}
                </div>
            </details>
        `);
    }
    return groups.join('');
}

function renderFinalRanking(players) {
    const sorted = [...players].sort((a, b) => scoreOf(b) - scoreOf(a));
    el('hostIndividualRankingList').innerHTML = sorted.length ? sorted.map((player, index) => `
        <li class="ranking-item ${index === 0 ? 'highlight' : ''}" style="margin-bottom: 8px;">
            <span class="ranking-rank">${index + 1}.</span>
            <span class="ranking-name">${escapeHtml(player.displayName)}</span>
            <span class="ranking-score">${scoreOf(player)}pt</span>
        </li>
    `).join('') : '<li class="text-muted">参加者がいません</li>';
    renderTeamRankingList(el('hostTeamRankingList'), room.teams || {}, players, room.rules || {});
}

function renderTeamRankingList(listEl, teams, players, rules) {
    if (!rules.teamMode) {
        listEl.innerHTML = '<li class="text-muted">チーム戦なし</li>';
        return;
    }
    const teamArray = Object.values(teams || {});
    if (!teamArray.length) {
        listEl.innerHTML = '<li class="text-muted">チーム未作成です</li>';
        return;
    }
    const playersByToken = Object.fromEntries(players.map(player => [player.playerToken, player]));
    listEl.innerHTML = teamArray.sort((a, b) => (b.score || 0) - (a.score || 0)).map((team, index) => {
        const members = (team.members || []).map(token => playersByToken[token]).filter(Boolean);
        const memberList = members.map(player => `<span class="team-member-chip">${escapeHtml(player.displayName)} ${scoreOf(player)}pt</span>`).join('');
        return `
            <li class="ranking-item" style="margin-bottom: 10px;">
                <div class="team-ranking-header" style="--team-color: ${team.color || 'var(--accent-cyan)'};">
                    <span class="ranking-rank">${index + 1}.</span>
                    <span class="team-name">${escapeHtml(team.teamName || 'チーム')}</span>
                    <span class="team-score">${team.score || 0}pt</span>
                </div>
                <div class="team-member-chips">${memberList || '<span class="text-muted">メンバーなし</span>'}</div>
            </li>
        `;
    }).join('');
}

function renderSettings(rules) {
    document.querySelectorAll('.setting-option').forEach(button => {
        const value = parseSettingValue(button.dataset.value);
        const currentValue = button.dataset.setting === 'answerRule'
            ? (rules.answerRule || 'classic')
            : rules[button.dataset.setting];
        button.classList.toggle('active', currentValue === value);
    });
    el('teamModeToggle').checked = Boolean(rules.teamMode);
    el('numTeamsInput').value = normalizeTeamCount(rules.numTeams || 2, room?.players?.length || 0);
    el('teamSettingsRow').classList.toggle('hidden', !rules.teamMode);
    el('createTeamsBtn').disabled = !rules.teamMode;
    updateTeamHint(room?.players?.length || 0);
}

function updateTeamHint(playerCount) {
    const maxTeams = Math.max(2, Math.floor(playerCount / 2));
    const value = normalizeTeamCount(el('numTeamsInput').value, playerCount);
    el('numTeamsInput').max = maxTeams;
    if (playerCount < 4) {
        el('teamCountHint').textContent = '参加者4人以上で作成できます';
    } else {
        const perTeam = Math.floor(playerCount / value);
        const remainder = playerCount % value;
        el('teamCountHint').textContent = `${value}チーム / ${perTeam}人 + 余り${remainder}人`;
    }
}

function normalizeTeamCount(value, playerCount) {
    const maxTeams = Math.max(2, Math.floor(playerCount / 2));
    const number = parseInt(value, 10) || 2;
    return Math.max(2, Math.min(number, maxTeams));
}

function scoreOf(player) {
    return player?.individualScore !== undefined ? player.individualScore : (player?.score || 0);
}

function parseSettingValue(value) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return /^-?\d+$/.test(value) ? Number(value) : value;
}

function networkLabel(player) {
    if (player.connectionStatus === 'offline') return 'offline';
    const rtt = Number.isFinite(player.bestRtt) && player.bestRtt > 0 ? player.bestRtt : player.rtt;
    const ms = Number.isFinite(rtt) && rtt > 0 ? `${Math.round(rtt)}ms` : 'sync';
    const labels = {
        good: '良好',
        fair: '普通',
        unstable: '不安定',
        measuring: '測定中'
    };
    return `${labels[player.connectionQuality] || '測定中'} ${ms}`;
}

function networkClass(player) {
    if (player.connectionStatus === 'offline') return 'network-offline';
    return `network-${player.connectionQuality || 'measuring'}`;
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
}
