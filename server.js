import { Hono } from 'hono';
import QRCode from 'qrcode';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
// Import WASM module của resvg
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';

const app = new Hono();

// =========================================================
// 0. KHỞI TẠO BIẾN TOÀN CỤC CHO WASM & FONT
// =========================================================
let wasmInitialized = false;
let fontBuffer = null;

// Hàm tải font chữ (Resvg cần font TTF/OTF để có thể vẽ chữ lên ảnh)
async function getFont() {
    if (fontBuffer) return fontBuffer;
    // Tải font Roboto Regular từ CDN
    const url = 'https://cdn.jsdelivr.net/gh/googlefonts/roboto@main/src/hinted/Roboto-Regular.ttf';
    const response = await fetch(url);
    fontBuffer = new Uint8Array(await response.arrayBuffer());
    return fontBuffer;
}

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
        // 🛠 KHU VỰC CĂN CHỈNH TỌA ĐỘ (Giữ nguyên của bạn)
        // =========================================================
        const frameWidth = 600; 
        const frameHeight = 800;

        const destX = 125;       
        const destY = 108;        
        const destWidth = 350;   
        const destHeight = 350;

        let textStartY = 590;    
        const lineSpacing = 30;  

        // ⚠️ Thay bằng chuỗi Base64 thật của bạn ở đây
        const frameBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAlgAAALGCAYAAACZCu/v..."; 
        const logoBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAALQAAAAtCAYAAAAHpEG5..."; 
        
        const textQR = buildMoMoQR(amount);
        const qrData = QRCode.create(textQR, { errorCorrectionLevel: 'H' });
        const modulesCount = qrData.modules.size;
        const cellSize = destWidth / modulesCount;

        // Xây dựng chuỗi SVG y như cũ
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${frameWidth} ${frameHeight}" width="${frameWidth}" height="${frameHeight}">`;

        svg += `<image href="${frameBase64}" x="0" y="0" width="${frameWidth}" height="${frameHeight}"/>`;
        svg += `<rect x="${destX}" y="${destY}" width="${destWidth}" height="${destHeight}" fill="#FFFFFF"/>`;

        // Vẽ chấm bi (QR Core)
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

        // 3 ô vuông lớn
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

        // Logo
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

        // Text
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
            // Cập nhật font-family về chuẩn chung để Resvg xử lý
            svg += `<text x="${midX}" y="${textStartY}" font-family="Roboto, Arial, sans-serif" font-weight="${fontWeight}" font-size="23" text-anchor="middle" dominant-baseline="hanging" fill="#000000">${line}</text>`;
            textStartY += lineSpacing;
        });

        svg += `</svg>`;

        // =========================================================
        // 3. CHUYỂN ĐỔI SVG THÀNH FILE PNG TRỰC TIẾP
        // =========================================================
        
        // Load engine Wasm (Chỉ chạy 1 lần)
        if (!wasmInitialized) {
            await initWasm(resvgWasm);
            wasmInitialized = true;
        }

        // Lấy font dữ liệu (Cache lại để không phải gọi API liên tục)
        const fontData = await getFont();

        // Render SVG qua Resvg
        const resvg = new Resvg(svg, {
            fitTo: { mode: 'width', value: frameWidth },
            font: {
                fontFiles: [fontData],       // Nạp font để vẽ chữ
                loadSystemFonts: false,      // CF Worker không có font hệ thống
                defaultFontFamily: 'Roboto', // Ép font mặc định
            }
        });

        const pngData = resvg.render();
        const pngBuffer = pngData.asPng();

        // Trả về luồng ảnh chuẩn PNG
        c.header('Content-Type', 'image/png');
        c.header('Cache-Control', 'public, max-age=31536000'); // Tùy chọn cache
        return c.body(pngBuffer);

    } catch (error) {
        console.error(error);
        return c.text('Lỗi: ' + error.message, 500);
    }
});

export default app;
