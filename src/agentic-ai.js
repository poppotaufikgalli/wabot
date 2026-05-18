const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const { pool } = require('./db.js');

const conversationHistory = new Map();

// ============================================================
// KNOWLEDGE BASE ISP — Sesuaikan dengan ISP kamu
// ============================================================
const ISP_CONTEXT = `
Kamu adalah CS Bot untuk ISP "BitFast".
Selalu gunakan Bahasa Indonesia yang sopan, ramah, dan singkat.
Format jawaban harus WA-friendly: pendek, pakai emoji seperlunya, maksimal 3 paragraf.
Jangan menjawab hal di luar layanan ISP ini.
Pada salam pembuka sampaikan begini:
Hai [nama_pelanggan], Selamat datang di Bitfast! Connecting You to the World : The Bitfast Journey.
kamu bisa memilih informasi awal kami dengan memilih menu berikut:

1. Tentang Layanan Kami (Cek detail paket dan harga)
2. Ingin Berlangganan? (Daftar dan Pasang Baru)
3. Ada Gangguan Jaringan? (Laporkan masalah teknis)
Terima kasih!.

TENTANG BITFAST:
Bitfast adalah perusahaan yang bergerak dibidang internet service provider.
• Menyediakan layanan internet cepat, stabil, dan terjangkau bagi masyarakat.
• Memberikan koneksi internet berkualitas dengan harga kompetitif.
• Menjangkau daerah yang masih terbatas akses internetnya.
• Menyediakan layanan pelanggan yang responsif dan handal.

PRODUK & PAKET:
A. *RUMAHAN BASIC* (Rp.160.000/bln), Kecepatan: 20 Mbps, Keunggulan: Internet Stabil, Kuota Unlimited!, Free Instalasi
B. *RUMAHAN MEDIUM* (Rp.180.000/bln), Kecepatan: 30 Mbps, Keunggulan: Internet Stabil, Kuota Unlimited!, Free Instalasi
C. *RUMAHAN PREMIUM* (Rp.210.000/bln), Kecepatan: 50 Mbps, Keunggulan: Internet Stabil, Kuota Unlimited!, Free Instalasi
D. *BISNIS STANDARD* (Rp. 520.000/bln), Kecepatan: 300 Mbps, Keunggulan: Internet Stabil, Kuota Unlimited!, Free Instalasi

SOP GANGGUAN INTERNET:
1. Minta customer restart ONT/router (cabut power 30 detik, pasang kembali)
2. Cek lampu indikator ONT:
   - Lampu PON/LOS merah = masalah sinyal fiber dari OLT kami
   - Lampu Internet merah = masalah autentikasi PPPoE
   - Semua lampu mati = masalah power/adaptor
3. Jika setelah restart masih bermasalah, minta pelanggan melengkapi data berikut: 
   - Nomor ID Pelanggan :
   - Nomor HP Aktif:
   - Alamat Lengkap: 
   - Info Gangguan : (sertakan warna lampu indikator pada modem/lampirkan foto modem)
4. Jika sudah melengkapi data gangguan, sampaikan bahwa tim CS akan segera menghubungi pelanggan dan akan eskalasi ke tim teknisi. 
5. Gangguan massal bisa dicek di: bitfast.id

PROSEDUR PASANG BARU:
- Isi data berikut untuk permintaan pasang baru:
  * Nama Lengkap : 
  * Nomor HP Aktif:
  * Alamat Lengkap: (sertakan RT/RW, Kelurahan, Kecamatan)
- Estimasi pemasangan: 1-3 hari kerja
- Area layanan: Semarang, Demak dan sekitarnya

MENGHUBUNGKAN DENGAN CS MANUSIA:
jika Pelanggan menyampaikan kata-kata:
- "saya mau bicara dengan CS"
- "ada orangnya?"
- "suruh CS yang bicara"
- "tolong hubungkan ke CS"
- "pindah ke CS"
- "chat dengan CS"
- "telepon saya"
- "suruh CS telepon saya"
- "telepon cs"
- "suruh cs telepon"
- atau frasa lain yang intinya meminta bicara dengan CS manusia

jika pelanggan menyampaikan kata seperti di atas, untuk konfirmasi, maka sampaikan apakah pelanggan yakin untuk berbicara dengan CS manusia?
jika iya, maka sampaikan "Baik, mohon tunggu sebentar ya. Saya akan bantu hubungkan percakapan ini ke CS kami. Terima kasih." dan kamu tidak aktif untuk sementara waktu dan jangan menjawab pertanyaan setelah ini!. Kamu bisa aktif kembali jika cs manusia mengembalikan percakapan ini dengan diawali karakter %%bot%% dan memberi pesan kepadamu.

BATASAN PENTING:
- Jika tidak tahu jawabannya, katakan jujur dan tawarkan eskalasi ke CS manusia
- Jangan memberikan informasi teknis yang tidak ada di knowledge base ini
- Jika customer marah atau komplain berat, segera tawarkan eskalasi ke CS manusia
- Jangan memberikan balasan apa-apa jika sudah berada pada CS manusia (beri tanda percakapan selesai dengan %%). 
`;

// ============================================================
// Engine Groq (provider cadangan — 14.400 req/hari gratis)
// ============================================================
async function callGroq(history, userMessage) {
    let dynamicKnowledge = '';
    try {
        const [rows] = await pool.query('SELECT * FROM ai_knowledge');
        if (rows.length > 0) {
            dynamicKnowledge = '\n\nTAMBAHAN PENGETAHUAN (KNOWLEDGE BASE DARI DATABASE):\n' + rows.map(r => `--- ${r.title} ---\n${r.content}`).join('\n\n');
        }
    } catch (err) {
        console.error('Error fetching AI knowledge from DB:', err);
    }

    const fullContext = ISP_CONTEXT + dynamicKnowledge;

    const messages = [
        { role: 'system', content: fullContext },
        ...history.map(msg => ({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.content,
        })),
        { role: 'user', content: userMessage },
    ];

    const result = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages,
        max_tokens: 500,
        temperature: 0.7,
    });

    return result.choices[0].message.content;
}

// ============================================================
// Fungsi utama: Proses pesan dengan Gemini AI
// ============================================================
async function processWithAI(customerId, userMessage, pushname) {
    // Ambil atau inisialisasi history untuk customer ini
    if (!conversationHistory.has(customerId)) {
        conversationHistory.set(customerId, []);
    }

    const history = conversationHistory.get(customerId);

    try {
        // Format history untuk Gemini (role: user/model)
        // const formattedHistory = history.map(msg => ({
        //     role: msg.role === 'assistant' ? 'model' : 'user',
        //     parts: [{ text: msg.content }],
        // }));

        // Mulai chat session dengan history yang ada
        // gemini-2.0-flash = model terbaru, gratis, cepat, cukup pintar untuk CS bot
        // const chat = genAI.chats.create({
        //     model: 'gemini-2.0-flash',
        //     config: {
        //         systemInstruction: ISP_CONTEXT,
        //         maxOutputTokens: 500,      // Batasi panjang jawaban
        //         temperature: 0.7,          // Sedikit kreatif tapi tetap konsisten
        //         topP: 0.8,
        //     },
        //     history: formattedHistory,
        // });


        // Kirim pesan user dan tunggu respons
        // const result = await chat.sendMessage({ message: userMessage });

        const aiReply = await callGroq(history, userMessage);

        // Simpan ke history (format internal)
        history.push({ role: 'user', content: userMessage });
        history.push({ role: 'assistant', content: aiReply });

        // Batasi history maksimal 20 pesan (10 bolak-balik) agar tidak membengkak
        if (history.length > 20) {
            history.splice(0, 2);
        }

        conversationHistory.set(customerId, history);

        // Cek apakah perlu eskalasi ke CS manusia
        if (needsEscalation(userMessage)) {
            return aiReply + '\n\n⚠️ _Kami akan menghubungkan Anda dengan CS kami. Mohon tunggu sebentar..._';
        }

        return aiReply;

    } catch (error) {
        console.error('Bot AI Error:', error.message);

        // Handle error rate limit (free tier)
        if (error.message?.includes('429') || error.message?.includes('quota')) {
            return (
                'Maaf, sistem kami sedang sibuk 🙏\n' +
                'Silakan coba lagi dalam beberapa menit.'
            );
        }

        return (
            'Maaf, terjadi gangguan pada sistem kami 🙏\n' +
            'Silakan coba lagi dalam beberapa menit.'
        );
    }
}

// ============================================================
// Deteksi apakah percakapan perlu dieskalasi ke manusia
// ============================================================
function needsEscalation(userMessage) {
    const msg = userMessage.toLowerCase();

    const escalationTriggers = [
        // Masalah berulang / sudah lama
        'sudah berhari', 'sudah seminggu', 'sudah lama', 'dari kemarin',
        'sudah 2 hari', 'sudah 3 hari', 'sudah dicoba', 'tetap mati', 'masih mati',

        // Emosi negatif / komplain serius
        'komplain', 'lapor', 'tidak puas', 'kecewa', 'marah', 'minta ganti rugi',
        'minta kompensasi', 'ancam', 'viral', 'media sosial',

        // Request khusus yang butuh manusia
        'minta teknisi', 'cabut langganan', 'berhenti berlangganan', 'pindah provider',
        'minta refund', 'minta keringanan',
    ];

    return escalationTriggers.some(trigger => msg.includes(trigger));
}

// ============================================================
// Utilitas: Reset history percakapan (misal setelah selesai)
// ============================================================
function resetConversation(customerId) {
    conversationHistory.delete(customerId);
}

// ============================================================
// Utilitas: Hitung estimasi penggunaan (monitoring free tier)
// ============================================================
let requestCount = 0;
const REQUEST_LIMIT_PER_DAY = 1500; // Batas gratis Gemini

function trackUsage() {
    requestCount++;
    if (requestCount >= REQUEST_LIMIT_PER_DAY * 0.9) {
        console.warn(`⚠️  Penggunaan API mendekati batas harian: ${requestCount}/${REQUEST_LIMIT_PER_DAY}`);
    }
    return requestCount;
}

module.exports = { processWithAI, resetConversation, trackUsage };