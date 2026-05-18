const { pool } = require('./db.js');

// In-memory session tracking
// const sessions = {};
const TIMEOUT_DURATION = 60000; // 1 minute in milliseconds

//async function processMsg(msg, client) {
async function processMsg(userId, body, pushname, session) {
    pushname = pushname != undefined ? 'kak *' + pushname + '*' : 'Pelanggan';

    const keyword = body.toLowerCase().trim();
    // Session logic
    if (!session || session.status === 'closed') {
        // Initialize new session
        session = {
            status: 'active',
            timeoutId: null,
            lastMessage: keyword,
            mode: 'bot' // 'bot' or 'agent'
        };

        const welcomeMessage = `Halo ${pushname}, Selamat datang di *Bitfast!* Connecting You to the World : The Bitfast Journey.\nAgar kami bisa membantu Anda dengan cepat, silakan pilih menu di bawah ini (Cukup ketik 1, 2, atau 3):\n\n1. Tentang Layanan Kami (Cek detail paket dan harga)\n2. Ingin Berlangganan? (Daftar dan Pasang Baru)\n3. Ada Gangguan Jaringan? (Laporkan masalah teknis)\n\nTerima kasih!`;

        return [welcomeMessage, session];
    } else {
        // If already in agent mode, just log and reset timeout without replying
        if (session.mode === 'agent') {
            console.log(`User ${userId} is in AGENT mode. Skipping auto-reply.`);

            // Reset timeout
            if (session.timeoutId) clearTimeout(session.timeoutId);
            // session.timeoutId = setTimeout(async () => {
            //     const closingMessage = `Terima kasih ${pushname} telah menghubungi *Bitfast*. \nPercakapan dengan Agen telah berakhir karena tidak ada aktivitas selama 1 menit. \nJika butuh bantuan lagi, jangan ragu untuk mengirim pesan kembali ya!`;

            //     session.status = 'closed';
            //     session.mode = 'bot';
            //     session.timeoutId = null;
            //     return closingMessage;
            // }, TIMEOUT_DURATION);

            // kembali menjadi chat bot
            //jika customer hanya mengetik 'bot' maka dianggap sebagai kembali menjadi chat bot
            if (keyword === 'bot' && session.lastMessage === keyword) {
                session.mode = 'bot';
                return ['Halo ' + pushname + ', bot kembali aktif loh..\n\nSelamat datang kembali di *Bitfast!* Connecting You to the World : The Bitfast Journey.\nAgar kami bisa membantu Anda dengan cepat, silakan pilih menu di bawah ini (Cukup ketik 1, 2, atau 3):\n\n1. Tentang Layanan Kami (Cek detail paket dan harga)\n2. Ingin Berlangganan? (Daftar dan Pasang Baru)\n3. Ada Gangguan Jaringan? (Laporkan masalah teknis)\n\nTerima kasih!', session];
            }

            //session.lastMessage = keyword;

            return ['', session];
        }

        // Duplicate message check
        if (session.lastMessage === keyword && session.status === 'active') {
            return ['Maaf kak, pesan yang kakak kirimkan sama dengan pesan sebelumnya. Silakan kirimkan pesan yang lain atau pilihan lain ya! 🙏', session];

            // Still reset timeout
            //             if (session.timeoutId) clearTimeout(session.timeoutId);
            //             session.timeoutId = setTimeout(async () => {
            //                 const closingMessage = `Terima kasih ${pushname} telah menghubungi *Bitfast*. 
            // Percakapan ini kami tutup karena tidak ada aktivitas selama 1 menit. 
            // Jika butuh bantuan lagi, jangan ragu untuk mengirim pesan kembali ya!`;
            //                 //await sendMessageWithLog(client, userId, closingMessage);
            //                 session.status = 'closed';
            //                 session.timeoutId = null;
            //                 return closingMessage;
            //             }, TIMEOUT_DURATION);

            return;
        }

        // Process active session
        //session.lastMessage = keyword;

        if (keyword.includes('menu') || keyword === '0') {
            const menuMessage = `Silakan pilih menu di bawah ini (Cukup ketik 1, 2, atau 3):\n\n1. Tentang Layanan Kami (Cek detail paket dan harga)\n2. Ingin Berlangganan? (Daftar dan Pasang Baru)\n3. Ada Gangguan Jaringan? (Laporkan masalah teknis)`;

            return [menuMessage, session];
        } else if (keyword === 'agen') {
            session.mode = 'agent';
            return [`Baik ${pushname}, mohon tunggu sebentar ya. Saya akan menghubungkan kakak dengan Agen Live Chat kami.\n\nSilakan sampaikan kendala atau pertanyaan kakak di sini. Bot akan non-aktif sementara sampai sesi berakhir.`, session];
        } else {
            // Cek kata kunci dinamis dari database
            try {
                const [rows] = await pool.query('SELECT * FROM isp_answers');
                for (const row of rows) {
                    const dbKeywords = row.keywords;
                    let isMatch = false;

                    if (dbKeywords.includes('%')) {
                        // LIKE matching misal: %halo%
                        const regexStr = '^' + dbKeywords.replace(/%/g, '.*') + '$';
                        try {
                            const regex = new RegExp(regexStr, 'i');
                            if (regex.test(keyword)) {
                                isMatch = true;
                            }
                        } catch (e) { }
                    } else if (dbKeywords.includes('"')) {
                        // Multi-word matching misal: "halo","hai"
                        const kwArray = dbKeywords.split(',').map(k => k.trim().replace(/^"|"$/g, '').toLowerCase());
                        if (kwArray.includes(keyword)) {
                            isMatch = true;
                        }
                    } else {
                        // Exact match
                        if (dbKeywords.toLowerCase() === keyword) {
                            isMatch = true;
                        }
                    }

                    if (isMatch) {
                        let answer = `${row.answer}`;
                        return [answer.replaceAll('\\n', '\n'), session];
                    }
                }
            } catch (err) {
                console.error('Error fetching ISP answers from DB:', err);
            }

            return [`Maaf ${pushname}, kami belum mengerti maksud kakak. Silakan ketik *Menu* untuk melihat pilihan layanan, atau ketik *agen* untuk berbicara dengan agen kami.`, session];
        }
    }

    // Reset session timeout
    if (session.timeoutId) {
        clearTimeout(session.timeoutId);
    }

    session.timeoutId = setTimeout(async () => {
        const closingMessage = `Terima kasih ${pushname} telah menghubungi *Bitfast*. 
Percakapan ini kami tutup karena tidak ada aktivitas selama 1 menit. 
Jika butuh bantuan lagi, jangan ragu untuk mengirim pesan kembali ya!`;
        await sendMessageWithLog(client, userId, closingMessage);
        session.status = 'closed';
        session.timeoutId = null;
    }, TIMEOUT_DURATION);
}

function needsEscalation(userMsg) {
    const escalationKeywords = [
        'tidak bisa', 'sudah coba', 'tetap mati', 'minta ganti',
        'komplain berat', 'lapor ke', 'sudah 3 hari'
    ];
    return escalationKeywords.some(kw => userMsg.toLowerCase().includes(kw));
}

module.exports = { processMsg, needsEscalation };