const express = require('express');
const nodemailer = require('nodemailer');
const https = require('https');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 透過 Brevo API (Port 443 HTTPS) 發送郵件，繞過 Render 封鎖 SMTP 埠的問題
function sendViaBrevoApi(apiKey, senderEmail, senderName, recipientEmail, recipientName, subject, htmlContent, attachments) {
    return new Promise((resolve, reject) => {
        const formattedAttachments = (attachments || []).map(att => {
            // 處理 Base64 資料格式
            const base64Content = att.data.includes(',') ? att.data.split(',')[1] : att.data;
            return {
                content: base64Content,
                name: att.filename
            };
        });

        const payload = {
            sender: { name: senderName || '業務開發團隊', email: senderEmail },
            to: [{ email: recipientEmail, name: recipientName || '夥伴' }],
            subject: subject,
            htmlContent: htmlContent
        };

        if (formattedAttachments.length > 0) {
            payload.attachment = formattedAttachments;
        }

        const data = JSON.stringify(payload);

        const options = {
            hostname: 'api.brevo.com',
            port: 443,
            path: '/v3/smtp/email',
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': apiKey,
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(data)
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(JSON.parse(body || '{}'));
                } else {
                    reject(new Error(`Brevo API 錯誤 (${res.statusCode}): ${body}`));
                }
            });
        });

        req.on('error', (err) => reject(err));
        req.write(data);
        req.end();
    });
}

// 發送郵件 API
app.post('/api/send-emails', async (req, res) => {
    const { recipients, subjectTemplate, bodyTemplate, smtpConfig, isMock, attachments } = req.body;

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ success: false, message: '收件人名單不得為空' });
    }

    const results = [];

    // 如果是模擬模式 (Mock Mode)，直接模擬發送
    if (isMock) {
        for (const recipient of recipients) {
            const companyName = recipient.company || '某公司';
            const contactName = recipient.name || '夥伴';
            const email = recipient.email;

            const personalizedSubject = subjectTemplate
                .replace(/{{companyName}}/g, companyName)
                .replace(/{{contactName}}/g, contactName);
            
            const personalizedBody = bodyTemplate
                .replace(/{{companyName}}/g, companyName)
                .replace(/{{contactName}}/g, contactName);

            await new Promise(resolve => setTimeout(resolve, 300));

            results.push({
                email,
                company: companyName,
                name: contactName,
                subject: personalizedSubject,
                body: personalizedBody,
                status: 'success',
                message: '模擬發送成功'
            });
        }
        return res.json({ success: true, results, mode: 'mock' });
    }

    // 真實發送模式 (優先使用 Brevo HTTP API 避開 Render 埠限制，若失敗則嘗試 SMTP)
    const config = smtpConfig || {};
    const smtpUser = (config.user && config.user.trim() !== '') ? config.user.trim() : process.env.SMTP_USER;
    const smtpPass = (config.pass && config.pass.trim() !== '') ? config.pass.trim() : process.env.SMTP_PASS;
    const senderName = (config.senderName && config.senderName.trim() !== '') ? config.senderName.trim() : '業務開發團隊';

    if (!smtpUser || !smtpPass) {
        return res.status(400).json({ success: false, message: '請填寫寄件者 Email 與 Brevo API Key（或於 Render 設定環境變數 SMTP_USER 與 SMTP_PASS）' });
    }

    try {
        for (const recipient of recipients) {
            const companyName = recipient.company || '某公司';
            const contactName = recipient.name || '夥伴';
            const email = recipient.email;

            const personalizedSubject = subjectTemplate
                .replace(/{{companyName}}/g, companyName)
                .replace(/{{contactName}}/g, contactName);
            
            const personalizedBody = bodyTemplate
                .replace(/{{companyName}}/g, companyName)
                .replace(/{{contactName}}/g, contactName);

            const htmlContent = personalizedBody.replace(/\n/g, '<br>');

            try {
                // 優先嘗試使用 Brevo HTTP API (Port 443 - 絕對不會被 Render 封鎖)
                await sendViaBrevoApi(smtpPass, smtpUser, senderName, email, contactName, personalizedSubject, htmlContent, attachments);

                results.push({
                    email,
                    company: companyName,
                    name: contactName,
                    status: 'success',
                    message: '發送成功 (API)'
                });
            } catch (apiErr) {
                // 若 API 失敗，嘗試使用傳統 SMTP 備用
                try {
                    const port = Number(config.port) || 587;
                    const transporter = nodemailer.createTransport({
                        host: config.host || 'smtp-relay.brevo.com',
                        port: port,
                        secure: port === 465,
                        auth: { user: smtpUser, pass: smtpPass },
                        tls: { rejectUnauthorized: false }
                    });

                    await transporter.sendMail({
                        from: `"${senderName}" <${smtpUser}>`,
                        to: email,
                        subject: personalizedSubject,
                        text: personalizedBody,
                        html: htmlContent,
                        attachments: (attachments || []).map(att => ({ filename: att.filename, path: att.data }))
                    });

                    results.push({
                        email,
                        company: companyName,
                        name: contactName,
                        status: 'success',
                        message: '發送成功 (SMTP)'
                    });
                } catch (smtpErr) {
                    results.push({
                        email,
                        company: companyName,
                        name: contactName,
                        status: 'error',
                        message: `API 錯誤: ${apiErr.message} | SMTP 錯誤: ${smtpErr.message}`
                    });
                }
            }
        }

        return res.json({ success: true, results, mode: 'brevo-api' });
    } catch (error) {
        return res.status(500).json({ success: false, message: `發送失敗: ${error.message}` });
    }
});

app.listen(PORT, () => {
    console.log(`伺服器已啟動：http://localhost:${PORT}`);
});
