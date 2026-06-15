import { Hono } from 'hono';
import QRCode from 'qrcode';
import { Resvg, initWasm } from '@resvg/resvg-wasm';

// Import trực tiếp file .wasm nội bộ của thư viện (Bypass lỗi bảo mật CSP của Cloudflare)
import wasmModule from '@resvg/resvg-wasm/index_bg.wasm';

const app = new Hono();

// =========================================================
// BIẾN GLOBAL CACHE ENGINE VÀ FONT (Chỉ tải 1 lần khi Worker khởi động)
// =========================================================
let isGraphicsReady = false;
let fontRegular = null;
let fontBold = null;

async function prepareGraphicsEngine() {
    if (isGraphicsReady) return;

    // Khởi tạo WASM trực tiếp từ module đã đóng gói nội bộ
    await initWasm(wasmModule);

    // Tải bộ Font chữ chuẩn hỗ trợ tiếng Việt không lỗi dấu từ Google CDN tĩnh
    const [regRes, boldRes] = await Promise.all([
        fetch('https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Me5Q.ttf'), 
        fetch('https://fonts.gstatic.com/s/roboto/v30/KFOlCnqEu92Fr1MmWUlfBBc9.ttf') 
    ]);
    fontRegular = await regRes.arrayBuffer();
    fontBold = await boldRes.arrayBuffer();

    isGraphicsReady = true;
}

// =========================================================
// 1. CÁC HÀM XỬ LÝ DỮ LIỆU MOMO (Chuẩn EMVCo)
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

        // Kích hoạt Engine đồ họa 
        await prepareGraphicsEngine();

        // =========================================================
        // 🛠 KHU VỰC CĂN CHỈNH TỌA ĐỘ
        // =========================================================
        const frameWidth = 600; 
        const frameHeight = 800;

        // Tọa độ vùng mã QR 
        const destX = 125;       
        const destY = 108;        
        const destWidth = 350;   
        const destHeight = 350;

        // Tọa độ gốc của chữ (Đẩy lên 570 để vừa vặn)
        let textStartY = 570;    
        const lineSpacing = 32;  

        // =========================================================
        // ⚠️ BẠN HÃY DÁN CHUỖI BASE64 THẬT CỦA BẠN VÀO 2 DÒNG DƯỚI ĐÂY:
        // =========================================================
        const frameBase64 = "data:image/png;base64,..."; 
        const logoBase64 = "data:image/png;base64,..."; 
        // =========================================================

        const textQR = buildMoMoQR(amount);
        const qrData = QRCode.create(textQR, { errorCorrectionLevel: 'H' });
        const modulesCount = qrData.modules.size;
        const cellSize = destWidth / modulesCount;

        // =========================================================
        // KHỞI TẠO MA TRẬN ĐỒ HỌA SVG
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

        // Lớp 5: Vẽ Logo ôm sát hình chữ nhật
        const origW = 400; 
        const origH = 100; 
        
        const maxLogoWidth = destWidth * 0.40; 
        const scale = maxLogoWidth / origW;
        
        const newLogoWidth = origW * scale;
        const newLogoHeight = origH * scale;

        const logoX = destX + (destWidth - newLogoWidth) / 2;
        const logoY = destY + (destHeight - newLogoHeight) / 2;
        const padding = 6; 

        svg += `<rect x="${logoX - padding}" y="${logoY - padding}" width="${newLogoWidth + (padding * 2)}" height="${newLogoHeight + (padding * 2)}" fill="#FFFFFF"/>`;
        svg += `<image href="${logoBase64}" x="${logoX}" y="${logoY}" width="${newLogoWidth}" height="${newLogoHeight}"/>`;

        // Lớp 6: Text thông tin bên dưới (Đã sửa lỗi hiển thị bằng dy)
        let textLines = [
            "Tên chủ TK: LE THANH LAM",
            "Số TK: 0935147989",
            "CTCP Dịch Vụ Di Động Trực Tuyến (MoMo)"
        ];

        if (amount > 0) {
            const formattedAmount = new Intl.NumberFormat('vi-VN').format(amount);
            textLines.unshift("Số tiền: " + formattedAmount + " VND");
        }

        const secondToLastIndex = textLines.length - 2;
        const midX = frameWidth / 2; 

        textLines.forEach((line, index) => {
            const fontWeight = (index === secondToLastIndex) ? 'bold' : 'normal';
            // Thay thế dominant-baseline="hanging" bằng dy="20" để Resvg đọc hiểu chính xác
            svg += `<text x="${midX}" y="${textStartY}" dy="20" font-family="Roboto, sans-serif" font-weight="${fontWeight}" font-size="21" text-anchor="middle" fill="#000000">${line}</text>`;
            textStartY += lineSpacing;
        });

        svg += `</svg>`;

        // =========================================================
        // BIÊN DỊCH SVG THÀNH ĐỊNH DẠNG FILE ẢNH PNG
        // =========================================================
        const resvg = new Resvg(svg, {
            fitTo: { mode: 'width', value: frameWidth },
            font: {
                fontFiles: [fontRegular, fontBold],
                loadSystemFonts: false,
                defaultFontFamily: 'Roboto'
            }
        });

        const pngBuffer = resvg.render().asPng();

        // Xuất trực tiếp ảnh PNG ra ngoài trình duyệt
        c.header('Content-Type', 'image/png');
        return c.body(pngBuffer);

    } catch (error) {
        console.error(error);
        return c.text('Lỗi hệ thống: ' + error.message, 500);
    }
});

export default app;
