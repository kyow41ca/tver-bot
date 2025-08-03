require('dotenv').config();
const express = require('express');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteerExtra.use(StealthPlugin());

const app = express();
const port = 3000;

app.get('/get-sid', async (req, res) => {
  let browser;
  try {
    browser = await puppeteerExtra.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    let sid = null;

    page.on('response', async (response) => {
      try {
        const url = response.url();
        if (url.includes('/members/login')) {
          const body = await response.text();
          const json = JSON.parse(body);
          if (json?.result?.member_sid) {
            sid = json.result.member_sid;
          }
        }
      } catch (err) {
        console.error('response error:', err);
      }
    });

    await page.goto('https://tver.jp/', { waitUntil: 'networkidle2' });

    const [agreeButton] = await page.$x("//button[contains(., '同意する')]");
    if (agreeButton) await agreeButton.click();

    await page.waitForSelector('button[class*="Visitor_login"]', { visible: true, timeout: 10000 });
    const loginButton = await page.$('button[class*="Visitor_login"]');
    if (loginButton) {
      await page.evaluate((btn) => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      }, loginButton);
    }

    await page.waitForTimeout(3000);
    const frames = page.frames();
    const loginFrame = frames.find(f => f.url().includes('login.html?umss='));
    if (!loginFrame) throw new Error('iframe not found');

    await loginFrame.type('input[id^="LoginFormPage_INPUT_USER"]', process.env.TVER_EMAIL);
    await loginFrame.type('input[id^="LoginFormPage_INPUT_PASSWORD"]', process.env.TVER_PASSWORD);

    const [loginSubmitButton] = await loginFrame.$x("//button[contains(., 'ログイン')]");
    if (loginSubmitButton) await loginSubmitButton.click();

    await page.waitForTimeout(5000);
    await browser.close();

    sid ? res.json({ sid }) : res.status(500).json({ error: 'SID not found' });

  } catch (err) {
    if (browser) await browser.close();
    res.status(500).json({ error: err.message });
  }
});

app.get('/get-m3u8', async (req, res) => {
  const { url: targetUrl, sid } = req.query;
  if (!targetUrl || !sid) return res.status(400).json({ success: false, message: 'Missing url or sid' });

  let browser;
  let m3u8Url = null;
  try {
    browser = await puppeteerExtra.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    await page.setCookie({
      name: 'member_sid',
      value: sid,
      domain: '.tver.jp',
      path: '/',
      httpOnly: true,
      secure: true
    });

    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('.m3u8') && url.includes('manifest.streaks.jp')) {
        if (!m3u8Url) m3u8Url = url;
      }
    });

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    const playButton = await page.$('#episode-play');
    if (playButton) await playButton.click();

    const frames = page.frames();
    const videoFrame = frames.find(f => f.url().includes('s.tver.jp'));
    if (videoFrame) {
      const innerButton = await videoFrame.$('button');
      if (innerButton) await innerButton.click();
    }

    const timeout = Date.now() + 30000;
    while (!m3u8Url && Date.now() < timeout) {
      await new Promise(r => setTimeout(r, 1000));
    }

    await browser.close();
    m3u8Url
      ? res.json({ success: true, m3u8: m3u8Url })
      : res.status(404).json({ success: false, message: 'm3u8 URL not found' });

  } catch (err) {
    if (browser) await browser.close();
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 Running at http://localhost:${port}`);
});
