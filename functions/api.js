const express = require('express');
const serverless = require('serverless-http');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HÀM CỨU CÁNH: Đọc body an toàn trên môi trường Netlify Serverless
const getSafeBody = (req) => {
    // Nếu express.json() hoạt động bình thường
    if (req.body && req.body.url) return req.body;
    
    // Nếu Netlify mã hóa body, chúng ta sẽ tự giải mã
    if (req.apiGateway && req.apiGateway.event && req.apiGateway.event.body) {
        try {
            const event = req.apiGateway.event;
            const rawBody = event.isBase64Encoded 
                ? Buffer.from(event.body, 'base64').toString('utf-8') 
                : event.body;
            return JSON.parse(rawBody);
        } catch (e) {
            return {};
        }
    }
    return {};
};

const MY_AFFILIATE_ID = "17344490003"; 
const resolvedLinksCache = {};

const router = express.Router();

router.get('/vouchers', async (req, res) => {
    try {
        const response = await axios.get('https://salesoc.vn/api/vouchers', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Origin': 'https://salesoc.vn',
                'Referer': 'https://salesoc.vn/',
                'Accept': 'application/json, text/plain, */*',
                'Cache-Control': 'no-cache', 
                'Pragma': 'no-cache'
            },
            timeout: 6000
        });

        if (response.data && Array.isArray(response.data)) {
            return res.json({
                success: true,
                vouchers: response.data
            });
        }

        return res.json({ success: false, message: "Không phân tích được danh sách voucher từ Salesoc" });
    } catch (error) {
        console.log("⚠️ Lỗi fetch dữ liệu voucher động từ Salesoc:", error.message);
        return res.json({ success: false, message: error.message });
    }
});

router.post('/product-info', async (req, res) => {
    try {
        // Sử dụng hàm an toàn để lấy data
        const body = getSafeBody(req);
        const url = body.url;
        
        if (!url) {
            return res.status(400).json({ success: false, message: 'Thiếu URL sản phẩm' });
        }

        const prodResponse = await axios.get(`https://data.addlivetag.com/product-data/product-data.php?url=${encodeURIComponent(url)}`, {
            timeout: 5000
        });

        if (prodResponse.data && prodResponse.data.status === "success") {
            const info = prodResponse.data.productInfo;
            
            if (info && info.productLink) {
                resolvedLinksCache[url.trim()] = info.productLink;
            }
            
            return res.json({
                success: true,
                productName: info.productName,
                price: info.price,
                sales: info.sales,
                rating: info.rating
            });
        }
        
        return res.json({ success: false, message: "Không lấy được chi tiết sản phẩm" });
    } catch (error) {
        return res.json({ success: false, message: error.message });
    }
});

router.post('/split-link', async (req, res) => {
    try {
        // Sử dụng hàm an toàn để lấy data
        const body = getSafeBody(req);
        const url = body.url;
        
        if (!url) {
            return res.status(400).json({ success: false, message: 'Vui lòng cung cấp link Shopee' });
        }

        try {
            const salesocResponse = await axios.post('https://salesoc.vn/api/convert-with-shelf', {
                url: url,
                isRetry: false
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Origin': 'https://salesoc.vn',
                    'Referer': 'https://salesoc.vn/'
                },
                timeout: 8000 
            });

            if (salesocResponse && salesocResponse.data && salesocResponse.data.success === true) {
                const data = salesocResponse.data;
                
                // SỬA ĐỔI: Chỉ lấy link từ cache, gỡ bỏ `|| url`
                const finalUrlForStep2 = resolvedLinksCache[url.trim()];

                // NẾU KHÔNG CÓ LINK DÀI -> CHẶN VÀ BÁO LỖI
                if (!finalUrlForStep2) {
                    return res.json({
                        success: false,
                        message: "Tạm hết mã giảm giá hoặc website đang quá tải, vui lòng thử lại sau 5s"
                    });
                }

                const step2AffiliateLink = `https://s.shopee.vn/an_redir?origin_link=${encodeURIComponent(finalUrlForStep2)}&affiliate_id=${MY_AFFILIATE_ID}`;

                const hasYoutube = data.hasYoutubeVoucher !== false;

                return res.json({
                    success: true,
                    fbLink: data.affipadShortUrl || data.shortFacebookAffiliateUrl || data.shortAffiliateUrl || "",
                    ytbLink: hasYoutube ? (data.affiliateUrl || "") : "",
                    igLink: data.shortInstagramAffiliateUrl || data.instagramAffiliateUrl || "",
                    step2: step2AffiliateLink
                });
            } else {
                return res.json({
                    success: false,
                    message: "Tạm hết mã giảm giá hoặc website đang quá tải, vui lòng thử lại sau 5s"
                });
            }
        } catch (apiErr) {
            return res.json({
                success: false,
                message: "Tạm hết mã giảm giá hoặc website đang quá tải, vui lòng thử lại sau 5s"
            });
        }

    } catch (error) {
        return res.json({ 
            success: false, 
            message: "Tạm hết mã giảm giá hoặc website đang quá tải, vui lòng thử lại sau 5s"
        });
    }
});

// Gắn router vào cả 2 dạng đường dẫn để bắt mọi cấu hình của Netlify
app.use(['/api', '/.netlify/functions/api'], router);

module.exports.handler = serverless(app);
