import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as Path from 'path';
import { TestRepo, writeFakeSsh } from '../helpers';
import { launchApp, LaunchedApp, openRecentRepo, sendMenuCommand } from './fixtures';

let dir: string;
let remote: TestRepo;
let repo: TestRepo;
let launched: LaunchedApp;
let page: Page;

// The repository reaches its origin through a fake ssh that asks for the passphrase of a key
test.beforeEach(async () => {
  dir = fs.realpathSync.native(fs.mkdtempSync(Path.join(os.tmpdir(), 'gitadmin-credentials-')));
  const sshPath = Path.join(dir, 'fake-ssh');
  writeFakeSsh(sshPath);
  remote = await TestRepo.create(Path.join(dir, 'remote'));
  await remote.commit('Initial', { 'file.txt': 'a\n' });
  repo = await TestRepo.create(Path.join(dir, 'analytical-engine'));
  await repo.git('remote', 'add', 'origin', `fakehost:${remote.workdir}`);
  await repo.git('config', 'core.sshCommand', sshPath);
  await repo.git('config', 'ssh.variant', 'simple');
  await repo.commit('Local', { 'local.txt': 'a\n' });
});

test.afterEach(async () => {
  expect(launched.pageErrors).toEqual([]);
  await launched.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function launch(env: Record<string, string> = {}) {
  launched = await launchApp({ settings: { recentlyOpened: [repo.workdir] }, env });
  page = launched.page;
  await openRecentRepo(page, repo);
}

function fetchButton() {
  return page.locator('.repo-toolbar').getByRole('button', { name: 'Fetch', exact: true });
}

async function remoteHead() {
  return (await repo.git('for-each-ref', '--format=%(objectname)', 'refs/remotes/origin/main')).trim();
}

test('asks for the passphrase of the key, again when it is wrong, and remembers it', async () => {
  await launch();
  await fetchButton().click();
  const dialog = page.getByRole('dialog', { name: 'Unlock SSH key' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Enter the passphrase of the SSH key /keys/id_test');
  const passphrase = dialog.getByLabel('Passphrase');
  await expect(passphrase).toBeFocused();
  await expect(passphrase).toHaveAttribute('type', 'password');
  await expect(dialog.getByRole('button', { name: 'Unlock' })).toBeDisabled();

  await passphrase.fill('wrong');
  await page.keyboard.press('Enter');
  // A new prompt for the second attempt
  await expect(dialog.getByLabel('Passphrase')).toHaveValue('');
  await expect(dialog.getByLabel('Passphrase')).toHaveAccessibleDescription(/try again \(attempt 2 of 3\)/);
  await dialog.getByLabel('Passphrase').fill('secret');
  await dialog.getByLabel('Remember until Gitadmin quits').check();
  await dialog.getByRole('button', { name: 'Unlock' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(remoteHead).toBe(await remote.sha('HEAD'));
  await expect(page.locator('.notification-queue li')).toHaveCount(0);

  // The next fetch does not ask
  const sha = await remote.commit('Remote change', { 'file.txt': 'b\n' });
  await fetchButton().click();
  await expect.poll(remoteHead).toBe(sha);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Until it is forgotten in the preferences
  await sendMenuCommand(launched.app, 'preferences');
  const preferences = page.getByRole('dialog', { name: 'Preferences' });
  await preferences.getByRole('tab', { name: 'Authentication' }).click();
  const panel = preferences.getByRole('tabpanel', { name: 'Authentication' });
  await expect(panel).toContainText('1 passphrase or password is remembered until Gitadmin quits.');
  await panel.getByRole('button', { name: 'Forget' }).click();
  await expect(panel).toContainText('No passphrase or password is remembered.');
  await page.keyboard.press('Escape');
  await expect(preferences).toHaveCount(0);
  await fetchButton().click();
  await expect(page.getByRole('dialog', { name: 'Unlock SSH key' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('stops the command without an error when the prompt is cancelled', async () => {
  await launch();
  await fetchButton().click();
  const dialog = page.getByRole('dialog', { name: 'Unlock SSH key' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  // The button stops spinning once the command is done
  await expect(fetchButton()).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.notification-queue li')).toHaveCount(0);
  expect(await remoteHead()).toBe('');
});

test('asks to trust an unknown host and shows its fingerprint', async () => {
  await launch({ FAKE_SSH_MODE: 'host-key' });
  await fetchButton().click();
  const dialog = page.getByRole('dialog', { name: 'Unknown SSH host' });
  await expect(dialog).toContainText('fakehost (192.0.2.1)');
  await expect(dialog.locator('.credential-fingerprint'))
    .toHaveText('ED25519 key fingerprint is SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU.');
  await dialog.getByRole('button', { name: 'Trust and connect' }).click();
  const unlock = page.getByRole('dialog', { name: 'Unlock SSH key' });
  await unlock.getByLabel('Passphrase').fill('secret');
  await page.keyboard.press('Enter');
  await expect.poll(remoteHead).toBe(await remote.sha('HEAD'));
  await expect(page.locator('.notification-queue li')).toHaveCount(0);
});

test('explains that the key of a host changed', async () => {
  await launch({ FAKE_SSH_MODE: 'changed-host-key' });
  await fetchButton().click();
  const toast = page.locator('.notification-queue li');
  await expect(toast).toHaveCount(1);
  await expect(toast).toContainText('The SSH host key of fakehost has changed');
  await expect(toast).toContainText('ssh-keygen -R fakehost');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('lists the SSH keys and saves the key of a host', async () => {
  const home = Path.join(dir, 'home');
  fs.mkdirSync(Path.join(home, '.ssh'), { recursive: true });
  fs.writeFileSync(Path.join(home, '.ssh', 'id_work'), '-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\n\nAAAA\n');
  fs.writeFileSync(Path.join(home, '.ssh', 'id_work.pub'), 'ssh-rsa AAAA ada@work\n');
  await launch({ HOME: home, USERPROFILE: home, SSH_AUTH_SOCK: '' });
  await sendMenuCommand(launched.app, 'preferences');
  const preferences = page.getByRole('dialog', { name: 'Preferences' });
  await preferences.getByRole('tab', { name: 'Authentication' }).click();
  const panel = preferences.getByRole('tabpanel', { name: 'Authentication' });
  await expect(panel).toContainText('No SSH agent is running.');
  await expect(panel.getByRole('list', { name: 'SSH keys' }).getByRole('listitem')).toHaveText(['id_workrsapassphraseada@work']);

  await panel.getByLabel('Host').fill('GitHub.com');
  await expect(panel.getByLabel('Key', { exact: true })).toHaveValue(Path.join(home, '.ssh', 'id_work'));
  await panel.getByRole('button', { name: 'Add' }).click();
  const hosts = panel.getByRole('list', { name: 'Keys of the hosts' }).getByRole('listitem');
  await expect(hosts).toHaveCount(1);
  await expect(hosts).toContainText('github.com');
  const userData = await launched.app.evaluate(({ app }) => app.getPath('userData'));
  const settings = () => JSON.parse(fs.readFileSync(Path.join(userData, 'Settings')).toString()).gitadmin;
  expect(settings().sshHostKeys).toEqual({ 'github.com': Path.join(home, '.ssh', 'id_work') });

  await panel.getByRole('button', { name: 'Use the agent for github.com' }).click();
  await expect(hosts).toHaveCount(0);
  expect(settings().sshHostKeys).toEqual({});
});

test('saves the HTTPS credentials with Git Credential Manager until it is turned off', async () => {
  await launch();
  await sendMenuCommand(launched.app, 'preferences');
  const preferences = page.getByRole('dialog', { name: 'Preferences' });
  await preferences.getByRole('tab', { name: 'Authentication' }).click();
  const panel = preferences.getByRole('tabpanel', { name: 'Authentication' });
  // The git of dugite comes with it on Linux x64
  const checkbox = panel.getByLabel('Save HTTPS credentials with Git Credential Manager');
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toHaveAccessibleDescription(/keychain of the system/);
  await checkbox.uncheck();
  const userData = await launched.app.evaluate(({ app }) => app.getPath('userData'));
  const settings = () => JSON.parse(fs.readFileSync(Path.join(userData, 'Settings')).toString()).gitadmin;
  expect(settings().credentialManager).toBe(false);
  await checkbox.check();
  expect(settings().credentialManager).toBe(true);
});
