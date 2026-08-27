const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 發送郵件 API
app.post('/api/send-emails', async (req, res) => {
    const { recipients, subjectTemplate, bodyTemplate, smtpConfig, isMock, attachments } = req.body;

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ success: false, message: '收件人名單不得為空' });
    }

    const emailAttachments = (attachments || []).map(att => ({
        filename: att.filename,
        path: att.data
    }));

    const results = [];

    // 如果是模擬模式 (Mock Mode) 或者未設定 SMTP，直接模擬發送
    if (isMock) {
        for (const recipient of recipients) {
            const companyName = recipient.company || '某公司';
            const contactName = recipient.name || '夥伴';
            const email = recipient.email;

            // 替換變數
            const personalizedSubject = subjectTemplate
                .replace(/{{companyName}}/g, companyName)
                .replace(/{{contactName}}/g, contactName);
            
            const personalizedBody = bodyTemplate
                .replace(/{{companyName}}/g, companyName)
                .replace(/{{contactName}}/g, contactName);

            // 模擬網路延遲
            await new Promise(resolve => setTimeout(resolve, 300));

            results.push({
                email,
                company: companyName,
                name: contactName,
                subject: personalizedSubject,
                body: personalizedBody,
                attachmentsCount: emailAttachments.length,
                status: 'success',
                message: `模擬發送成功（含 ${emailAttachments.length} 個附件）`
            });
        }
        return res.json({ success: true, results, mode: 'mock' });
    }

    // 真實發送模式 (SMTP)
    try {
        const config = smtpConfig || {};
        const port = Number(config.port) || 587;
        const smtpUser = config.user || process.env.SMTP_USER;
        const smtpPass = config.pass || process.env.SMTP_PASS;
        const smtpHost = config.host || 'smtp-relay.brevo.com';
        const senderName = config.senderName || '業務開發團隊';

        if (!smtpUser || !smtpPass) {
            return res.status(400).json({ success: false, message: '請填寫 SMTP 帳號與密碼（或於 Render 設定環境變數）' });
        }

        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: port,
            secure: port === 465, // true for 465 (SSL), false for 587 (TLS)
            auth: {
                user: smtpUser,
                pass: smtpPass
            },
            tls: {
                rejectUnauthorized: false
            }
        });

        // 驗證連線
        await transporter.verify();

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

            try {
                await transporter.sendMail({
                    from: `"${senderName}" <${smtpUser}>`,
                    to: email,
                    subject: personalizedSubject,
                    text: personalizedBody,
                    html: personalizedBody.replace(/\n/g, '<br>'),
                    attachments: emailAttachments
                });

                results.push({
                    email,
                    company: companyName,
                    name: contactName,
                    status: 'success',
                    message: '發送成功'
                });
            } catch (err) {
                results.push({
                    email,
                    company: companyName,
                    name: contactName,
                    status: 'error',
                    message: err.message
                });
            }
        }

        return res.json({ success: true, results, mode: 'smtp' });
    } catch (error) {
        return res.status(500).json({ success: false, message: `SMTP 連線或驗證失敗: ${error.message}` });
    }
});

app.listen(PORT, () => {
    console.log(`伺服器已啟動：http://localhost:${PORT}`);
});
