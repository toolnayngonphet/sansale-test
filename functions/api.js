const express = require('express');
const serverless = require('serverless-http');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

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
        const { url } = req.body;
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
                console.log(`🎯 Đã lưu cache link dài từ Addlivetag: ${info.productLink}`);
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
        console.log("⚠️ Lỗi fetch dữ liệu thông tin sản phẩm:", error.message);
        return res.json({ success: false, message: error.message });
    }
});

router.post('/split-link', async (req, res) => {
    try {
        const { url } = req.body;
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
                
                const finalUrlForStep2 = resolvedLinksCache[url.trim()] || url;
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
            console.log('⚠️ Không lấy được voucher từ Salesoc:', apiErr.message);
            
            return res.json({
                success: false,
                message: "Tạm hết mã giảm giá hoặc website đang quá tải, vui lòng thử lại sau 5s"
            });
        }

    } catch (error) {
        console.error("❌ Lỗi Core Hệ Thống:", error);
        return res.json({ 
            success: false, 
            message: "Tạm hết mã giảm giá hoặc website đang quá tải, vui lòng thử lại sau 5s"
        });
    }
});

app.use('/api', router);

module.exports.handler = serverless(app);