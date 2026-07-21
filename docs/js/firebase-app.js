// Firebase設定（speedbottun プロジェクト）

const firebaseConfig = {
    apiKey: "AIzaSyDYG4inoWVhzdW2wrqL0LtR8HwEAIyEzCQ",
    authDomain: "speedbottun.firebaseapp.com",
    databaseURL: "https://speedbottun-default-rtdb.firebaseio.com",
    projectId: "speedbottun",
    storageBucket: "speedbottun.firebasestorage.app",
    messagingSenderId: "867697396230",
    appId: "1:867697396230:web:17be5e915c05ada9ccd187"
};

// Firebase初期化（複数回の初期化を防止）
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const database = firebase.database();

// 匿名ログイン（安全な実装）
function setupFirebaseAuth() {
    if (typeof firebase === 'undefined' || !firebase.auth) {
        console.warn('Firebase Auth が読み込まれていません。再度試みます...');
        setTimeout(setupFirebaseAuth, 100);
        return;
    }
    
    firebase.auth().onAuthStateChanged((user) => {
        if (!user) {
            firebase.auth().signInAnonymously().catch((error) => {
                console.error('匿名ログインエラー:', error);
            });
        } else {
            console.log('✅ ログイン済み:', user.uid);
        }
    });
}

// DOM読み込み後に認証を設定
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupFirebaseAuth);
} else {
    setupFirebaseAuth();
}

// アプリバージョン
const APP_VERSION = 'v1.7.0';
window.APP_VERSION = APP_VERSION; // グローバルスコープで使用可能

let appInitialized = false;

document.addEventListener('DOMContentLoaded', () => {
    // フッター追加
    const footer = document.createElement('footer');
    footer.style.textAlign = 'center';
    footer.style.padding = '20px';
    footer.style.opacity = '0.6';
    footer.style.fontSize = '0.8rem';
    footer.style.marginTop = 'auto';
    footer.innerHTML = `Buzzer Quiz App ${window.APP_VERSION}`;

    // 特定のコンテナがあればそこに追加、なければbody末尾
    const container = document.querySelector('.host-container, .player-container, .setup-card, .join-card');
    if (container) {
        // containerがflex columnの場合、最後に追加すれば下にくる
        container.appendChild(footer);
    } else {
        document.body.appendChild(footer);
    }
    
    appInitialized = true;
});

// ユーティリティ関数
function generateRoomCode() {
    // 6桁の数字
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function generatePin() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

function generateToken() {
    return 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// デフォルトルール
const DEFAULT_RULES = {
    penaltyType: 'thisRound',
    correctPoints: 1,
    wrongPoints: 0,
    minScore: 0,
    allowNegative: false,
    wrongAction: 'reopen',
    answerRule: 'classic',
    teamMode: false,
    numTeams: 2
};

const TEAM_NAMES = [
    'サンダー', 'フェニックス', 'オーロラ', 'テンペスト', 'グリフォン', 'ノヴァ', 'コスモス', 'ルミナス',
    'アトラス', 'ゼファー', 'ブリザード', 'エクリプス', 'ストーム', 'ブレイズ', 'タイタン', 'セイバー',
    'ヴァイパー', 'ファルコン', 'ドラゴン', 'ユニコーン', 'ミラージュ', 'ステラ', 'プラズマ', 'ラディアント',
    'オリオン', 'リゲル', 'シリウス', 'ベガ', 'アルタイル', 'カノープス', 'カペラ', 'ポラリス',
    'レグルス', 'スピカ', 'アンタレス', 'アルデバラン', 'ベテルギウス', 'アークティック', 'フレイム', 'ガーネット',
    'サファイア', 'エメラルド', 'トパーズ', 'ルビー', 'オブシディアン', 'アメジスト', 'クォーツ', 'アクア',
    'コバルト', 'シトリン', 'オニキス', 'パール', 'コメット', 'メテオ', 'ギャラクシー', 'ネビュラ',
    'ボルテックス', 'インフェルノ', 'サイクロン', 'マグマ', 'グレイシャー', 'モンスーン', 'ハリケーン', 'タイフーン',
    'エレメント', 'エーテル', 'オメガ', 'アルファ', 'シグマ', 'カイ', 'ラムダ', 'デルタ',
    'プロトン', 'ニュートロン', 'クエーサー', 'パルサー', 'メサ', 'アストラ', 'アリア', 'カリバー',
    'ランサー', 'レイダー', 'ジャガー', 'パンサー', 'リンクス', 'ウルフ', 'フォックス', 'ホーク',
    'バイソン', 'レイヴン', 'リオン', 'グリズリー', 'コヨーテ', 'ハスキー', 'クーガー', 'レオパード',
    'エンバー', 'ブリーズ', 'ドリフト', 'グリット', 'ブロッサム', 'ブリッジ', 'プラネット', 'ソニック',
    'ハーモニー', 'フロンティア', 'サーガ', 'クエスト', 'レジェンド', 'ライジング', 'エヴォルブ', 'ユニティ'
];

function shuffleArray(items) {
    const arr = items.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function pickTeamNames(count) {
    const pool = shuffleArray(TEAM_NAMES);
    if (pool.length >= count) {
        return pool.slice(0, count);
    }
    const names = pool.slice();
    while (names.length < count) {
        names.push(`チーム${names.length + 1}`);
    }
    return names;
}

function generateTeamColors(count) {
    const colors = [];
    if (count <= 0) return colors;
    for (let i = 0; i < count; i++) {
        const hue = Math.round((360 / count) * i);
        colors.push(`hsl(${hue}, 70%, 55%)`);
    }
    return colors;
}

// ルーム管理クラス
class RoomManager {
    constructor() {
        this.roomCode = null;
        this.roomRef = null;
        this.listeners = [];
    }

    // ルーム作成
    async createRoom() {
        let code;
        let exists = true;

        // ユニークなコードを生成
        while (exists) {
            code = generateRoomCode();
            const snapshot = await database.ref(`rooms/${code}`).once('value');
            exists = snapshot.exists();
        }

        const pin = generatePin();
        const room = {
            roomCode: code,
            hostPin: pin,
            rules: DEFAULT_RULES,
            roundNumber: 1,
            roomState: 'WAITING',
            canAdvance: false,
            openTimestamp: null,
            winner: null,
            players: {},
            teams: {},
            createdAt: firebase.database.ServerValue.TIMESTAMP
        };

        await database.ref(`rooms/${code}`).set(room);
        this.roomCode = code;
        this.roomRef = database.ref(`rooms/${code}`);

        return { roomCode: code, pin };
    }

    // ルーム参加
    async joinRoom(roomCode) {
        const snapshot = await database.ref(`rooms/${roomCode}`).once('value');
        if (!snapshot.exists()) {
            throw new Error('ROOM_NOT_FOUND');
        }

        this.roomCode = roomCode;
        this.roomRef = database.ref(`rooms/${roomCode}`);
        return snapshot.val();
    }

    // ホスト認証
    async verifyPin(roomCode, pin) {
        const snapshot = await database.ref(`rooms/${roomCode}/hostPin`).once('value');
        return snapshot.val() === pin;
    }

    // プレイヤー追加
    async addPlayer(playerToken, displayName) {
        const playerRef = this.roomRef.child(`players/${playerToken}`);
        const snapshot = await playerRef.once('value');

        if (snapshot.exists()) {
            // 再接続
            await playerRef.update({
                connectionStatus: 'online',
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            });
            return snapshot.val();
        }

        // 新規参加 - 同名チェック
        const playersSnapshot = await this.roomRef.child('players').once('value');
        const players = playersSnapshot.val() || {};
        const existingNames = Object.values(players).map(p => p.displayName);

        let finalName = displayName;
        let counter = 2;
        while (existingNames.includes(finalName)) {
            finalName = `${displayName}#${counter}`;
            counter++;
        }

        const player = {
            playerToken,
            displayName: finalName,
            score: 0,
            individualScore: 0,
            teamId: null,
            playerState: 'READY',
            penaltyNextRound: false,
            connectionStatus: 'online',
            lastSeen: firebase.database.ServerValue.TIMESTAMP
        };

        await playerRef.set(player);
        return player;
    }

    // プレイヤー切断
    async disconnectPlayer(playerToken) {
        await this.roomRef.child(`players/${playerToken}`).update({
            connectionStatus: 'offline',
            lastSeen: firebase.database.ServerValue.TIMESTAMP
        });
    }

    // ルーム状態監視
    onRoomUpdate(callback) {
        const listener = this.roomRef.on('value', (snapshot) => {
            callback(snapshot.val());
        });
        this.listeners.push({ ref: this.roomRef, event: 'value', listener });
    }

    // 早押し解放
    async openBuzz(forceClearPenalty = true) {
        await this.roomRef.update({
            roomState: 'OPEN',
            canAdvance: false,
            openTimestamp: firebase.database.ServerValue.TIMESTAMP,
            winner: null,
            buzzQueue: null,
            supportVotes: null
        });

        const playersSnapshot = await this.roomRef.child('players').once('value');
        const players = playersSnapshot.val() || {};
        const updates = {};

        for (const token in players) {
            const p = players[token];
            if (forceClearPenalty) {
                // 全員解除 / 手動ボタン
                updates[`players/${token}/playerState`] = 'READY';
                updates[`players/${token}/penaltyNextRound`] = null;
            } else {
                // ペナルティ維持 / 自動再開などの場合
                // LOCKED_PENALTY_THIS 以外の、回答済み(PRESSED)や先着落ち(LOCKED_LOST)をREADYに戻す
                if (p.playerState === 'PRESSED' || p.playerState === 'LOCKED_LOST') {
                    updates[`players/${token}/playerState`] = 'READY';
                }
            }
        }

        if (Object.keys(updates).length > 0) {
            await this.roomRef.update(updates);
        }
    }

    // チーム作成（ホスト操作）
    async createTeams(requestedTeams) {
        const roomSnapshot = await this.roomRef.once('value');
        const room = roomSnapshot.val();
        if (!room) return { success: false, error: 'ROOM_NOT_FOUND' };

        const players = room.players || {};
        const playerTokens = Object.keys(players);
        const playerCount = playerTokens.length;
        const maxTeams = Math.floor(playerCount / 2);

        if (playerCount < 4 || maxTeams < 2) {
            return { success: false, error: 'NOT_ENOUGH_PLAYERS' };
        }

        let teamCount = parseInt(requestedTeams, 10);
        if (!teamCount || Number.isNaN(teamCount)) {
            teamCount = room.rules && room.rules.numTeams ? room.rules.numTeams : 2;
        }
        teamCount = Math.max(2, Math.min(teamCount, maxTeams));

        const teamIds = [];
        const teamNames = pickTeamNames(teamCount);
        const teamColors = generateTeamColors(teamCount);
        const teams = {};
        for (let i = 0; i < teamCount; i++) {
            const teamId = `team_${i + 1}`;
            teamIds.push(teamId);
            teams[teamId] = {
                teamId,
                teamName: teamNames[i],
                score: 0,
                members: [],
                color: teamColors[i]
            };
        }

        const shuffledPlayers = shuffleArray(playerTokens);
        const updates = {
            teams,
            'rules/teamMode': true,
            'rules/numTeams': teamCount
        };

        const teamScores = {};
        teamIds.forEach((teamId) => {
            teamScores[teamId] = 0;
        });

        shuffledPlayers.forEach((token, idx) => {
            const teamId = teamIds[idx % teamCount];
            const individualScore = players[token].individualScore !== undefined
                ? players[token].individualScore
                : (players[token].score || 0);

            teams[teamId].members.push(token);
            teamScores[teamId] += individualScore;

            updates[`players/${token}/teamId`] = teamId;
            updates[`players/${token}/individualScore`] = individualScore;
            updates[`players/${token}/score`] = individualScore;
        });

        teamIds.forEach((teamId) => {
            teams[teamId].score = teamScores[teamId];
        });

        await this.roomRef.update(updates);
        return { success: true, teamCount };
    }

    // 早押し
    async buzz(playerToken) {
        const roomSnapshot = await this.roomRef.once('value');
        const room = roomSnapshot.val();

        if (room.roomState !== 'OPEN') {
            return { success: false, error: 'NOT_OPEN' };
        }

        const player = room.players[playerToken];
        if (!player || player.playerState !== 'READY') {
            return { success: false, error: 'CANNOT_BUZZ' };
        }

        // トランザクションで先着判定
        const result = await this.roomRef.transaction((data) => {
            if (!data) return data;
            if (data.roomState !== 'OPEN') return data;
            if (data.winner) return data; // 既に先着者がいる

            const reactionTime = Date.now() - data.openTimestamp;

            data.roomState = 'LOCKED';
            data.winner = {
                playerToken,
                displayName: player.displayName,
                reactionTime
            };
            data.supportVotes = {};

            // 押したプレイヤーをPRESSEDに
            if (data.players[playerToken]) {
                data.players[playerToken].playerState = 'PRESSED';
            }

            // 他のREADYプレイヤーをLOCKED_LOSTに
            for (const t in data.players) {
                if (t !== playerToken && data.players[t].playerState === 'READY') {
                    data.players[t].playerState = 'LOCKED_LOST';
                }
            }

            return data;
        });

        if (result.committed) {
            const newRoom = result.snapshot.val();
            const isWinner = newRoom.winner && newRoom.winner.playerToken === playerToken;
            return { success: true, isWinner, winner: newRoom.winner };
        }

        return { success: false, error: 'TRANSACTION_FAILED' };
    }

    // 回答への支持投票（回答者自身は投票不可、1人1票）
    async castSupportVote(playerToken, choice) {
        if (choice !== 'support' && choice !== 'oppose') {
            return { success: false, error: 'INVALID_CHOICE' };
        }

        const result = await this.roomRef.transaction((data) => {
            if (!data || data.roomState !== 'LOCKED' || !data.winner || !data.players) return;
            if (data.rules?.answerRule !== 'support') return;
            if (data.winner.playerToken === playerToken || !data.players[playerToken]) return;
            const playerState = data.players[playerToken].playerState;
            if (playerState === 'LOCKED_PENALTY_THIS' || playerState === 'LOCKED_PENALTY_NEXT') return;
            data.supportVotes = data.supportVotes || {};
            if (data.supportVotes[playerToken]) return;
            data.supportVotes[playerToken] = { choice };
            return data;
        });

        return result.committed
            ? { success: true }
            : { success: false, error: 'VOTING_CLOSED_OR_ALREADY_VOTED' };
    }

    // 判定と支持投票の集計を同じトランザクションで確定する。
    async judge(result) {
        if (result !== 'correct' && result !== 'wrong') {
            return { success: false, error: 'INVALID_RESULT' };
        }

        const transaction = await this.roomRef.transaction((room) => {
            if (!room || room.roomState !== 'LOCKED' || !room.winner || !room.players) return;

            room.backup = JSON.parse(JSON.stringify({
                players: room.players,
                teams: room.teams || null,
                roomState: room.roomState,
                roundNumber: room.roundNumber,
                winner: room.winner,
                canAdvance: room.canAdvance || false,
                supportVotes: room.supportVotes || null
            }));

            const winnerToken = room.winner.playerToken;
            const winner = room.players[winnerToken];
            const rules = room.rules || DEFAULT_RULES;
            if (!winner) return;

            const addPoints = (token, points) => {
                const target = room.players[token];
                const current = target.individualScore !== undefined ? target.individualScore : (target.score || 0);
                target.individualScore = current + points;
                target.score = target.individualScore;
                if (rules.teamMode && target.teamId && room.teams && room.teams[target.teamId]) {
                    room.teams[target.teamId].score = (room.teams[target.teamId].score || 0) + points;
                }
            };

            const isSupportRule = rules.answerRule === 'support';

            if (result === 'correct') {
                addPoints(winnerToken, isSupportRule ? 2 : rules.correctPoints);
                if (isSupportRule) {
                    Object.entries(room.supportVotes || {}).forEach(([token, vote]) => {
                        if (token !== winnerToken && room.players[token] && vote.choice === 'support') {
                            addPoints(token, 1);
                        }
                    });
                }
                room.roomState = 'WAITING';
                room.canAdvance = true;
                room.winner = null;
                Object.values(room.players).forEach((target) => { target.playerState = 'READY'; });
            } else {
                let newScore = (winner.individualScore !== undefined ? winner.individualScore : (winner.score || 0)) - rules.wrongPoints;
                if (!rules.allowNegative && newScore < rules.minScore) newScore = rules.minScore;
                winner.individualScore = newScore;
                winner.score = newScore;
                if (rules.teamMode && winner.teamId && room.teams && room.teams[winner.teamId]) {
                    let teamScore = (room.teams[winner.teamId].score || 0) - rules.wrongPoints;
                    if (!rules.allowNegative && teamScore < rules.minScore) teamScore = rules.minScore;
                    room.teams[winner.teamId].score = teamScore;
                }
                room.canAdvance = true;
                if (rules.penaltyType === 'thisRound') winner.playerState = 'LOCKED_PENALTY_THIS';
                if (rules.penaltyType === 'nextRound') {
                    winner.playerState = 'LOCKED_PENALTY_THIS';
                    winner.penaltyNextRound = true;
                }
                if (isSupportRule) {
                    Object.entries(room.supportVotes || {}).forEach(([token, vote]) => {
                        if (token !== winnerToken && room.players[token] && vote.choice === 'support') {
                            room.players[token].playerState = 'LOCKED_PENALTY_THIS';
                        }
                    });
                }
                room.roomState = 'LOCKED';
                room.winner = null;
            }

            room.supportVotes = null;
            return room;
        });

        return transaction.committed ? { success: true } : { success: false, error: 'INVALID_STATE' };
    }

    // 判定を戻す (Undo)
    async restoreBackup() {
        const roomSnapshot = await this.roomRef.once('value');
        const room = roomSnapshot.val();

        if (!room.backup) {
            return { success: false, error: 'NO_BACKUP' };
        }

        const updates = {
            players: room.backup.players,
            teams: room.backup.teams || null,
            roomState: room.backup.roomState,
            roundNumber: room.backup.roundNumber,
            winner: room.backup.winner,
            canAdvance: room.backup.canAdvance || false,
            supportVotes: room.backup.supportVotes || null,
            backup: null // 使用後は消去
        };

        // 判定（LOCKEDでwinnerあり）のUndoなら、強制的にOPEN（受付中）に戻す
        if (room.backup.roomState === 'LOCKED' && room.backup.winner) {
            updates.roomState = 'OPEN';
            updates.winner = null;
            updates.supportVotes = null;
            // 回答中だった人の状態をREADYに戻す
            const winnerToken = room.backup.winner.playerToken;
            if (updates.players && updates.players[winnerToken]) {
                // オブジェクトのディープコピーが必要な場合があるが、ここでは直接書き換え
                updates.players[winnerToken].playerState = 'READY';
                // ペナルティNextRoundも巻き戻す場合に備え既存のバックアップ値を尊重
            }
        }

        await this.roomRef.update(updates);
        return { success: true };
    }

    // 次のラウンド
    async nextRound() {
        const roomSnapshot = await this.roomRef.once('value');
        const room = roomSnapshot.val();

        // バックアップ（Undo用）- undefined値を除外
        const backup = {
            players: room.players,
            teams: room.teams || null,
            roomState: room.roomState,
            roundNumber: room.roundNumber,
            canAdvance: room.canAdvance || false
        };

        const updates = {
            roundNumber: (room.roundNumber || 1) + 1,
            roomState: 'OPEN', // 明示的にOPENに
            canAdvance: false,
            openTimestamp: firebase.database.ServerValue.TIMESTAMP,
            winner: null,
            backup: backup
        };

        // プレイヤー状態の更新（ペナルティ処理）
        for (const t in room.players) {
            const player = room.players[t];
            if (player.penaltyNextRound) {
                // 次のラウンドで休み
                updates[`players/${t}/playerState`] = 'LOCKED_PENALTY_THIS';
                updates[`players/${t}/penaltyNextRound`] = false;
            } else {
                updates[`players/${t}/playerState`] = 'READY';
            }
        }

        // Firebase に null/undefined を送信しないようにクリーンアップ
        const cleanUpdates = {};
        const traverse = (obj, prefix) => {
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    const value = obj[key];
                    if (value === null || value === undefined) {
                        // スキップ
                    } else if (typeof value === 'object' && !Array.isArray(value)) {
                        traverse(value, prefix ? `${prefix}/${key}` : key);
                    } else {
                        cleanUpdates[prefix ? `${prefix}/${key}` : key] = value;
                    }
                }
            }
        };

        // backup オブジェクト用のクリーンアップ
        const cleanBackup = {};
        if (backup.players) cleanBackup.players = backup.players;
        if (backup.teams) cleanBackup.teams = backup.teams;
        if (backup.roomState) cleanBackup.roomState = backup.roomState;
        if (backup.roundNumber) cleanBackup.roundNumber = backup.roundNumber;
        if (backup.canAdvance !== undefined) cleanBackup.canAdvance = backup.canAdvance;

        const finalUpdates = {
            roundNumber: updates.roundNumber,
            roomState: updates.roomState,
            canAdvance: updates.canAdvance,
            openTimestamp: updates.openTimestamp,
            winner: null,
            backup: cleanBackup
        };

        // プレイヤー更新をマージ
        for (const t in room.players) {
            const player = room.players[t];
            if (player.penaltyNextRound) {
                finalUpdates[`players/${t}/playerState`] = 'LOCKED_PENALTY_THIS';
                finalUpdates[`players/${t}/penaltyNextRound`] = false;
            } else {
                finalUpdates[`players/${t}/playerState`] = 'READY';
            }
        }

        await this.roomRef.update(finalUpdates);
        return { success: true, roundNumber: finalUpdates.roundNumber };
    }

    // ルール更新
    async updateRules(newRules) {
        await this.roomRef.child('rules').update(newRules);
    }

    // ゲーム終了
    async finishGame() {
        await this.roomRef.update({
            roomState: 'FINISHED',
            canAdvance: false,
            winner: null
        });
    }

    // クリーンアップ
    cleanup() {
        this.listeners.forEach(({ ref, event, listener }) => {
            ref.off(event, listener);
        });
        this.listeners = [];
    }
}

// グローバルインスタンス
const roomManager = new RoomManager();window.roomManager = roomManager; // グローバルに割り当て
