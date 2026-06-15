import { Hono } from 'hono';
import QRCode from 'qrcode';

const app = new Hono();

// =========================================================
// 1. CÁC HÀM XỬ LÝ DỮ LIỆU MOMO (Giữ nguyên 100%)
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
// 2. ROUTE XỬ LÝ CHÍNH TRÊN CLOUDFLARE
// =========================================================
app.get('*', async (c) => {
    try {
        const url = new URL(c.req.url);
        
        // Kiểm tra tham số test
        if (url.searchParams.get('test') === '1') {
            return c.text('ok');
        }

        const amountParam = url.searchParams.get('amount');
        const amount = amountParam ? parseInt(amountParam, 10) : 0;

        // Tọa độ và kích thước QR
        const destX = 125, destY = 65, destWidth = 350, destHeight = 350;
        
        // Kích thước mặc định của ảnh frame (Cần sửa lại theo đúng size thật của frame-momo-qr.png)
        const frameWidth = 600; 
        const frameHeight = 800;

        // Mã hóa Base64 ảnh Local (Thay chuỗi này bằng ảnh thực tế của bạn)
        const frameBase64 = "data:image/png;base64,...(Dán mã base64 của frame-momo-qr.png vào đây)...";
        const logoBase64 = "data:image/png;base64,...(Dán mã base64 của logo2.png vào đây)...";

        const textQR = buildMoMoQR(amount);
        const qrData = QRCode.create(textQR, { errorCorrectionLevel: 'H' });
        const modulesCount = qrData.modules.size;
        const cellSize = destWidth / modulesCount;

        // =========================================================
        // 3. VẼ ĐỒ HỌA BẰNG SVG STRING (THAY THẾ CHO CANVAS)
        // =========================================================
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${frameWidth} ${frameHeight}" width="${frameWidth}" height="${frameHeight}">`;

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
        const origW = 200, origH = 200; // Thay bằng size thật của logo2.png
        const scale = Math.min(maxLogoSize / origW, maxLogoSize / origH);
        
        const newLogoWidth = origW * scale;
        const recurringHeight = origH * scale;

        const logoX = destX + (destWidth - newLogoWidth) / 2;
        const logoY = destY + (destHeight - recurringHeight) / 2;
        const padding = 5;

        // Nền trắng cho logo
        svg += `<rect x="${logoX - padding}" y="${logoY - padding}" width="${newLogoWidth + (padding * 2)}" height="${recurringHeight + (padding * 2)}" fill="#FFFFFF"/>`;
        // Ảnh logo
        svg += `<image href="${logoBase64}" x="${logoX}" y="${logoY}" width="${newLogoWidth}" height="${recurringHeight}"/>`;

        // Lớp 6: Text thông tin
        let textLines = [
            "Tên chủ TK: LE THANH LAM",
            "Số TK: 0935147989",
            "CTCP Dịch Vụ Di Động Trực Tuyến (MoMo)"
        ];

        if (amount > 0) {
            const formattedAmount = new Intl.NumberFormat('vi-VN').format(amount);
            textLines.unshift("Số tiền: " + formattedAmount + " VND");
        }

        let currentY = 530; 
        const lineSpacing = 30; 
        const secondToLastIndex = textLines.length - 2;
        const midX = frameWidth / 2; // Căn giữa theo khung hình

        textLines.forEach((line, index) => {
            const fontWeight = (index === secondToLastIndex) ? 'bold' : 'normal';
            // Dùng font hệ thống, bỏ qua bước load file .ttf nặng nề
            svg += `<text x="${midX}" y="${currentY}" font-family="Arial, sans-serif" font-weight="${fontWeight}" font-size="23" text-anchor="middle" dominant-baseline="hanging" fill="#000000">${line}</text>`;
            currentY += lineSpacing;
        });

        svg += `</svg>`;

        // Trả về kết quả hiển thị trên trình duyệt
        c.header('Content-Type', 'image/svg+xml');
        return c.body(svg);

    } catch (error) {
        console.error(error);
        return c.text('Lỗi: ' + error.message, 500);
    }
});

export default app;