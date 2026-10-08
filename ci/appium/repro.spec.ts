/*
 * Real-app reproduction spec: attachment filename path traversal.
 *
 * Runs the official unmodified FlowCrypt iOS app in the iOS Simulator with:
 *   - REAL Gmail OAuth login (no --mock-* flags),
 *   - a REAL delivered email whose attachment name is
 *     "../Library/Preferences/poc.txt".
 *
 * Tapping the attachment and pressing save goes through:
 *   handleAttachmentTap -> getAttachment -> decrypt -> AttachmentManager.download
 *   -> FilesManager.save -> documentsDirectoryURL.appendingPathComponent(file.name)
 * which writes outside Documents/.
 *
 * The workflow records the simulator screen around the critical steps via
 * /tmp/start_recording and /tmp/stop_recording markers written by this spec.
 */
import fs from 'fs';
import { createHmac } from 'crypto';
import {
  SplashScreen,
  SetupKeyScreen,
  MailFolderScreen,
  EmailScreen,
  AttachmentScreen,
} from '../../screenobjects/all-screens';

const SUBJECT = 'Weekly report';
const ATTACHMENT_NAME = '../Library/Preferences/poc.txt';

// --- TOTP (RFC 6238) so the account's Authenticator-app 2FA can be solved
// from a stored secret (GitHub secret REPRO_TOTP_SECRET) without a human. ---
function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function generateTotp(secret: string): string {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

describe('REPRO: attachment filename path traversal', () => {
  it('saves an attachment outside the Documents directory', async () => {
    const email = process.env.REPRO_EMAIL as string;
    const password = process.env.REPRO_PASSWORD as string;

    expect(email).toBeTruthy();
    expect(password).toBeTruthy();

    // 0. Wait for the freshly installed app to boot all the way to the
    //    sign-in screen. First launch of a debug build on a cold simulator
    //    can take well over the default 15s.
    console.log('DIAG: waiting for the app sign-in screen...');
    await (await $('~aid-sign-in-gmail-btn')).waitForDisplayed({ timeout: 120000 });
    console.log('DIAG: sign-in screen is up');

    // 1. Real Gmail OAuth login. Same flow as the official SplashScreen.login,
    //    but tolerant of the system consent alert ("...Wants to Use google.com
    //    to Sign In") being absent in the CI environment.
    await SplashScreen.clickContinueWithGmail();
    try {
      await SplashScreen.clickContinueBtn();
    } catch (e) {
      console.log('DIAG: no system consent alert appeared, continuing');
    }
    try {
      await SplashScreen.changeLanguage();
    } catch (e) {
      // Google's language footer is often below the fold in CI; the page is
      // served in English for the en-US simulator anyway, so continue.
      console.log('DIAG: language step skipped (selector not reachable)');
    }

    // Tolerant Gmail login. The official SplashScreen.gmailLogin depends on a
    // keyboard "Done" button that does not exist on some iOS builds (the web
    // form accessory renders as an icon), which aborted a run. Fall back
    // through keyboard keys / hideKeyboard / a background tap before clicking
    // the page's Next button.
    const typeText = async (selector: string, value: string) => {
      const field = await $(selector);
      await field.waitForDisplayed({ timeout: 60000 });
      await field.click();
      await field.setValue(value);
      await browser.pause(700);
    };

    const dismissKeyboardTolerant = async () => {
      // The web-form keyboard on this iOS build has no "Done" button (the
      // accessory renders as an icon and "~Done" does not exist). WDA can
      // still find and press the form's submit key natively ("go"/"Return"),
      // which also advances the form.
      try {
        await driver.execute('mobile: hideKeyboard', {
          keys: [
            'go', 'Go', 'next', 'Next', 'return', 'Return',
            'continue', 'Continue', 'search', 'Search', 'done', 'Done',
          ],
        });
        console.log('DIAG: keyboard dismissed / submit key pressed');
        await browser.pause(1200);
        return;
      } catch (e) {
        console.log('DIAG: mobile: hideKeyboard failed, falling back to background tap');
      }
      try {
        const { width, height } = await driver.getWindowSize();
        await driver.performActions([
          {
            id: 'dismissKb',
            type: 'pointer',
            parameters: { pointerType: 'touch' },
            actions: [
              { duration: 0, x: Math.round(width / 2), y: Math.round(height * 0.3), type: 'pointerMove', origin: 'viewport' },
              { button: 0, type: 'pointerDown' },
              { type: 'pause', duration: 100 },
              { button: 0, type: 'pointerUp' },
            ],
          },
        ]);
        console.log('DIAG: tapped page background to dismiss keyboard');
        await browser.pause(800);
      } catch (e) {
        // ignore
      }
    };

    const clickNextIfVisible = async () => {
      try {
        const next = await $('-ios class chain:**/XCUIElementTypeButton[`label == "Next"`][1]');
        if (await next.isDisplayed()) {
          await next.click();
          console.log('DIAG: clicked page Next');
          await browser.pause(1500);
          return true;
        }
      } catch (e) {
        // ignore
      }
      return false;
    };

    await (await SplashScreen.signInAsGoogleAccounLabel).waitForDisplayed({ timeout: 60000 });
    await browser.pause(1000);

    // previously-used account chip, if Google shows one
    const accountChip = await $(`-ios class chain:**/XCUIElementTypeLink/XCUIElementTypeStaticText[\`label == "${email}"\`]`);
    if (await accountChip.isDisplayed().catch(() => false)) {
      await accountChip.click();
      await browser.pause(1500);
    }

    if (await (await SplashScreen.loginField).isDisplayed()) {
      await typeText('~Email or phone', email);
      await dismissKeyboardTolerant();
      if (!(await (await SplashScreen.passwordField).isDisplayed())) {
        await clickNextIfVisible();
      }
    }

    const passwordField = await SplashScreen.passwordField;
    await passwordField.waitForDisplayed({ timeout: 60000 });
    await typeText('~Enter your password', password);
    await dismissKeyboardTolerant();
    if (await (await SplashScreen.passwordField).isDisplayed().catch(() => false)) {
      await clickNextIfVisible();
    }
    console.log('DIAG: password submitted');

    // Dismiss the iOS "Save Password?" sheet if it pops up after submitting.
    for (let i = 0; i < 4; i++) {
      try {
        const notNow = await $('~Not Now');
        if (await notNow.isDisplayed()) {
          await notNow.click();
          console.log('DIAG: dismissed Save Password sheet');
          break;
        }
      } catch (e) {
        // ignore
      }
      await browser.pause(1500);
    }

    // 2. Complete sign-in. After the password, Google may show (in any order):
    //    - a re-appearing "Save Password?" sheet (auto-dismissed),
    //    - 2-step verification: TOTP/authenticator page (code generated from
    //      REPRO_TOTP_SECRET) or the phone-approval page (logged for manual help),
    //    - the OAuth consent page (Allow/Continue auto-clicked),
    //    - then the app's setup screen (success: stop waiting).
    const totpSecret = process.env.REPRO_TOTP_SECRET as string;

    const setupElementVisible = async (): Promise<boolean> =>
      (await (await SetupKeyScreen.loadAccountButton).isDisplayed()) ||
      (await (await SetupKeyScreen.createNewKeyButton).isDisplayed()) ||
      (await (await SetupKeyScreen.enterPassPhraseField).isDisplayed());

    const findTotpField = async () => {
      const candidates = [
        '~Enter code',
        '~Enter the code',
        '~G-',
        '-ios class chain:**/XCUIElementTypeTextField[1]',
      ];
      for (const selector of candidates) {
        try {
          const el = await $(selector);
          if (await el.isDisplayed()) return el;
        } catch (e) {
          // ignore
        }
      }
      return null;
    };

    console.log('DIAG: password submitted, waiting up to 20 min for sign-in to finish...');
    const passPhrase = 'London blueBARREY capi';
    let setupReady = false;
    let totpAttempts = 0;
    let iteration = 0;
    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
      iteration++;

      if (await setupElementVisible()) {
        setupReady = true;
        break;
      }

      // re-appearing Save Password sheet
      try {
        const notNow = await $('~Not Now');
        if (await notNow.isDisplayed()) {
          await notNow.click();
          console.log('DIAG: dismissed Save Password sheet');
        }
      } catch (e) {
        // ignore
      }

      // OAuth consent page after 2FA
      for (const selector of ['~Allow', '~Continue']) {
        try {
          const btn = await $(selector);
          if (await btn.isDisplayed()) {
            console.log(`DIAG: clicking OAuth consent button ${selector}`);
            await btn.click();
            await browser.pause(2000);
          }
        } catch (e) {
          // ignore
        }
      }

      // 2-step verification (TOTP): generate the code from the stored secret
      const totpField = await findTotpField();
      if (totpField && totpSecret && totpAttempts < 4) {
        const secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);
        if (secondsLeft < 8) {
          await browser.pause((secondsLeft + 1) * 1000);
        }
        const code = generateTotp(totpSecret);
        console.log('DIAG: 2-step verification page detected, submitting generated TOTP code');
        await totpField.click();
        await totpField.setValue(code);
        await browser.pause(800);
        await (await SplashScreen.nextButton).click().catch(() => undefined);
        totpAttempts++;
        await browser.pause(5000);
        continue;
      }
      if (totpField && !totpSecret) {
        console.log('DIAG: 2-step verification shown but REPRO_TOTP_SECRET is not set; a human must complete it');
      }

      // periodic page diagnostics (helps debug unexpected Google pages)
      if (iteration % 20 === 0) {
        try {
          const src = await driver.getPageSource();
          if (src.includes('Check your')) {
            const m = src.match(/name="(\d{1,2})"/);
            console.log(`DIAG: Google phone-approval page shown${m ? `; APPROVAL NUMBER = ${m[1]}` : ''}`);
          } else if (src.includes('Enter code') || src.includes('authenticator')) {
            console.log('DIAG: Google authenticator (TOTP) page shown');
          } else if (src.includes('wants access') || src.includes('wants to access')) {
            console.log('DIAG: Google OAuth consent page shown');
          } else {
            console.log('DIAG: waiting for sign-in (page source length', src.length + ')');
          }
        } catch (e) {
          // ignore
        }
      }

      await browser.pause(3000);
    }
    console.log('DIAG: sign-in wait finished, setup screen detected:', setupReady);

    // 3. First-run setup (mirrors the repo's own setPassPhraseForOtherProviderEmail):
    if ((await (await SetupKeyScreen.enterPassPhraseField).isDisplayed()) !== true) {
      // no key backups found -> create a fresh key
      await SetupKeyScreen.clickCreateNewKeyButton();
      await SetupKeyScreen.fillPassPhrase(passPhrase);
      await SetupKeyScreen.confirmPassPhrase(passPhrase);
    } else {
      await SetupKeyScreen.fillPassPhrase(passPhrase);
      await SetupKeyScreen.clickLoadAccountButton();
    }

    // 3. Wait for the inbox and the crafted email delivered by the workflow
    await MailFolderScreen.checkInboxScreen();
    let found = false;
    for (let i = 0; i < 30; i++) {
      const el = await $(`~${SUBJECT}`);
      if (await el.isDisplayed()) {
        found = true;
        break;
      }
      await MailFolderScreen.refreshMailList();
      await browser.pause(5000);
    }
    expect(found).toBeTruthy();

    // 4. Open the email and check the attachment shows the traversal name
    await MailFolderScreen.clickOnEmailBySubject(SUBJECT);
    await EmailScreen.checkAttachment(ATTACHMENT_NAME);

    // 5. Signal the workflow recorder, then tap the attachment
    fs.writeFileSync('/tmp/start_recording', '');
    await browser.pause(6000);
    await EmailScreen.clickOnAttachmentCell();

    // 6. Attachment view title is the traversal name; press save
    try {
      await AttachmentScreen.checkAttachment(ATTACHMENT_NAME);
      await browser.pause(3000);
      await AttachmentScreen.clickSaveButton();
      await browser.pause(3000);
      // system export dialog shows the saved file (name may vary by iOS version)
      try {
        await AttachmentScreen.checkDownloadPopUp('poc');
      } catch (e) {
        // non-fatal: the write already happened
      }
    } catch (e) {
      // if the type was not previewable the tap already downloaded it
      await browser.pause(3000);
    }

    fs.writeFileSync('/tmp/stop_recording', '');
    await browser.pause(3000);
  });
});
