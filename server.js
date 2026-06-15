import { Hono } from 'hono';
import QRCode from 'qrcode';

const app = new Hono();

// =========================================================
// 1. CÁC HÀM XỬ LÝ DỮ LIỆU MOMO (Giữ nguyên)
// =========================================================
function crc16_ccitt_false(str) {
    let crc = 0xFFFF;
    for (let c = 0; c < str.length; c++) {
        crc ^= (str.charCodeAt(c) << 8);
        for (let i = 0; i < 8; i++) {
            if (crc & 0x8000) {
                crc = ((crc << 1) ^ 0x1021) >>> 0;
            } else {
                crc = (crc << 1) >>> 0;
            }
        }
    }
    return crc & 0xFFFF;
}

function buildMoMoQR(amount) {
    const payloadFormatIndicator = "000201";
    const pointOfInitiation = "010211"; 
    const merchantAccountInfo = "38540010A00000072701240006971025011009351479890208QRIBFTTA";
    const transactionCurrency = "5303704";
    const countryCode = "5802VN";
    const additionalData = "62180514MOMOW2W6831853";

    let transactionAmount = "";
    if (amount > 0) {
        const amountStr = amount.toString();
        const length = amountStr.length.toString().padStart(2, '0');
        transactionAmount = "54" + length + amountStr;
    }

    let payload = payloadFormatIndicator 
                + pointOfInitiation 
                + merchantAccountInfo 
                + transactionCurrency 
                + transactionAmount 
                + countryCode 
                + additionalData;

    payload += "6304";
    const crc = crc16_ccitt_false(payload);
    const crcHex = crc.toString(16).toUpperCase().padStart(4, '0');

    return payload + crcHex;
}

// =========================================================
// 2. ROUTE XỬ LÝ CHÍNH
// =========================================================
app.get('*', async (c) => {
    try {
        const url = new URL(c.req.url);
        
        if (url.searchParams.get('test') === '1') {
            return c.text('ok');
        }

        const amountParam = url.searchParams.get('amount');
        const amount = amountParam ? parseInt(amountParam, 10) : 0;

        // =========================================================
        // 🛠 KHU VỰC CĂN CHỈNH TỌA ĐỘ (ĐÃ SỬA LẠI)
        // =========================================================
        const frameWidth = 600; 
        const frameHeight = 800;

        // 1. Tọa độ của vùng mã QR 
        const destX = 105;       // Đẩy mạnh sang trái (Cũ là 140)
        const destY = 50;        // Đẩy lên trên (Cũ là 80)
        const destWidth = 310;   // Thu nhỏ một chút để tạo lề trắng bọc quanh viền (Cũ là 320)
        const destHeight = 310;

        // 2. Tọa độ chữ (Đang hiển thị rất đẹp nên giữ nguyên)
        let textStartY = 590;    
        const lineSpacing = 30;  

        // 3. Chuỗi Base64 Ảnh (Nhớ dán lại mã của bạn vào đây nhé)
        const frameBase64 = "data:image/png;base64,..."; 
        const logoBase64 = "data:image/png;base64,..."; 
        // =========================================================

        const textQR = buildMoMoQR(amount);
        const qrData = QRCode.create(textQR, { errorCorrectionLevel: 'H' });
        const modulesCount = qrData.modules.size;
        const cellSize = destWidth / modulesCount;

        // =========================================================
        // KHỞI TẠO SVG 
        // =========================================================
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${frameWidth} ${frameHeight}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="max-height: 100vh; max-width: 100vw; display: block; margin: 0 auto;">`;

        // Lớp 1: Ảnh nền Frame
        svg += `<image href="${frameBase64}" x="0" y="0" width="${frameWidth}" height="${frameHeight}"/>`;

        // Lớp 2: Nền trắng cho mã QR
        svg += `<rect x="${destX}" y="${destY}" width="${destWidth}" height="${destHeight}" fill="#FFFFFF"/>`;

        // Lớp 3: Vẽ chấm bi (QR Core)
        for (let row = 0; row < modulesCount; row++) {
            for (let col = 0; col < modulesCount; col++) {
                const isDark = qrData.modules.data[row * modulesCount + col];
                
                const isFinderTL = row <= 6 && col <= 6;
                const isFinderTR = row <= 6 && col >= modulesCount - 7;
                const isFinderBL = row >= modulesCount - 7 && col <= 6;
                
                if (isFinderTL || isFinderTR || isFinderBL) continue; 
                
                if (isDark) {
                    const centerX = destX + col * cellSize + cellSize / 2;
                    const centerY = destY + row * cellSize + cellSize / 2;
                    const radius = cellSize * 0.42; 
                    svg += `<circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="#000000"/>`;
                }
            }
        }

        // Lớp 4: Hàm vẽ 3 ô vuông lớn bo góc (Finders)
        const drawFinderSVG = (startCol, startRow) => {
            const x = destX + startCol * cellSize;
            const y = destY + startRow * cellSize;
            const outerSize = 7 * cellSize;
            const r = cellSize * 1.5; 
            
            let f = `<rect x="${x}" y="${y}" width="${outerSize}" height="${outerSize}" rx="${r}" ry="${r}" fill="#000000"/>`;
            f += `<rect x="${x + cellSize}" y="${y + cellSize}" width="${5 * cellSize}" height="${5 * cellSize}" rx="${r * 0.75}" ry="${r * 0.75}" fill="#FFFFFF"/>`;
            f += `<rect x="${x + 2 * cellSize}" y="${y + 2 * cellSize}" width="${3 * cellSize}" height="${3 * cellSize}" rx="${r * 0.5}" ry="${r * 0.5}" fill="#000000"/>`;
            return f;
        };
        
        svg += drawFinderSVG(0, 0); 
        svg += drawFinderSVG(modulesCount - 7, 0); 
        svg += drawFinderSVG(0, modulesCount - 7); 

        // Lớp 5: Vẽ Logo MoMo ở giữa
        const maxLogoSize = destWidth * 0.30;
        const origW = 200, origH = 200; 
        const scale = Math.min(maxLogoSize / origW, maxLogoSize / origH);
        
        const newLogoWidth = origW * scale;
        const recurringHeight = origH * scale;

        const logoX = destX + (destWidth - newLogoWidth) / 2;
        const logoY = destY + (destHeight - recurring
