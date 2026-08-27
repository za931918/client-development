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
        const transporter = nodemailer.createTransport({
            host: smtpConfig.host,
            port: Number(smtpConfig.port),
            secure: Number(smtpConfig.port) === 465, // true for 465, false for other ports
            auth: {
                user: smtpConfig.user,
                pass: smtpConfig.pass
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
                    from: `"${smtpConfig.senderName || '業務開發團隊'}" <${smtpConfig.user}>`,
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
        return res.status(500).json({ success: false, message: `SMTP 連線失敗: ${error.message}` });
    }
});

app.listen(PORT, () => {
    console.log(`伺服器已啟動：http://localhost:${PORT}`);
});
