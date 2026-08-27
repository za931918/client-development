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

// 透過 Brevo API (Port 443 HTTPS) 發送郵件
function sendViaBrevoApi(apiKey, senderEmail, senderName, recipientEmail, recipientName, subject, htmlContent, attachments) {
    return new Promise((resolve, reject) => {
        const formattedAttachments = (attachments || []).map(att => {
            const base64Content = att.data.includes(',') ? att.data.split(',')[1] : att.data;
            return {
                content: base64Content,
                name: att.filename
            };
        });

        const payload = {
            sender: { name: senderName || 'CASA CYCLES 業務團隊', email: senderEmail },
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

    // 真實發送模式 (支援 Gmail SMTP 或 Brevo API)
    const config = smtpConfig || {};
    const host = (config.host || '').trim().toLowerCase();
    const port = Number(config.port) || (host.includes('gmail') ? 465 : 587);
    const smtpUser = (config.user && config.user.trim() !== '') ? config.user.trim() : process.env.SMTP_USER;
    const smtpPass = (config.pass && config.pass.trim() !== '') ? config.pass.trim() : process.env.SMTP_PASS;
    const senderName = (config.senderName && config.senderName.trim() !== '') ? config.senderName.trim() : 'CASA CYCLES 業務團隊';

    if (!smtpUser || !smtpPass) {
        return res.status(400).json({ success: false, message: '請填寫完整的 SMTP 帳號與密碼' });
    }

    try {
        // 如果是 Gmail 或使用 Port 465，使用 Nodemailer SMTP 發送
        if (host.includes('gmail') || port === 465 || host === 'smtp.gmail.com') {
            const transporter = nodemailer.createTransport({
                host: host || 'smtp.gmail.com',
                port: port,
                secure: port === 465,
                auth: { user: smtpUser, pass: smtpPass },
                tls: { rejectUnauthorized: false }
            });

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
                        attachments: (attachments || []).map(att => ({ filename: att.filename, path: att.data }))
                    });

                    results.push({ email, company: companyName, name: contactName, status: 'success', message: '發送成功 (Gmail SMTP)' });
                } catch (err) {
                    results.push({ email, company: companyName, name: contactName, status: 'error', message: err.message });
                }
            }
            return res.json({ success: true, results, mode: 'gmail-smtp' });
        } else {
            // Brevo API 模式
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
                    await sendViaBrevoApi(smtpPass, smtpUser, senderName, email, contactName, personalizedSubject, htmlContent, attachments);
                    results.push({ email, company: companyName, name: contactName, status: 'success', message: '發送成功 (Brevo API)' });
                } catch (apiErr) {
                    results.push({ email, company: companyName, name: contactName, status: 'error', message: apiErr.message });
                }
            }
            return res.json({ success: true, results, mode: 'brevo-api' });
        }
    } catch (error) {
        return res.status(500).json({ success: false, message: `發送失敗: ${error.message}` });
    }
});

app.listen(PORT, () => {
    console.log(`伺服器已啟動：http://localhost:${PORT}`);
});
