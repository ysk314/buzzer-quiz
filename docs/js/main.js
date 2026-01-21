// ランディングページJS
document.addEventListener('DOMContentLoaded', () => {
    const joinForm = document.getElementById('joinForm');
    const roomCodeInput = document.getElementById('roomCodeInput');

    // URLパラメータからルームコードを取得
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl) {
        roomCodeInput.value = roomFromUrl.toUpperCase();
    }

    // 入力時に大文字変換
    roomCodeInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });

    // 参加フォーム送信
    joinForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const roomCode = roomCodeInput.value.trim().toUpperCase();

        if (roomCode.length !== 6) {
            alert('ルームコードは6文字です');
            return;
        }

        window.location.href = `/player.html?room=${roomCode}`;
    });
});
