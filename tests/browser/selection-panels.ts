import type { Page } from '@playwright/test';

/** Start a separate direct-link scenario without a saved scene taking priority. */
export async function clearSavedScene(page: Page) {
  if (!page.url().startsWith('http')) return;
  await page.evaluate(() => {
    window.dispatchEvent(new Event('pagehide'));
    localStorage.removeItem('uf-robots:scene');
  });
}

export async function selectRobot(page: Page, id: string) {
  await page.locator('#robot-select').selectOption(id);
}

export async function selectRail(page: Page, id: string) {
  await page.locator('#rail-toggle').setChecked(id === 'al0700');
}

export async function selectGripper(page: Page, id: string) {
  await page.locator('#tool-gripper-select').selectOption(id);
}

/** Use the public one-degree buttons to arrange an integer-angle pose efficiently. */
export async function jogJointTo(page: Page, index: number, target: number) {
  return page.evaluate(({ index, target }) => {
    const output = document.querySelector(`#stage-joint-${index}`)!;
    const initial = Number(output.textContent);
    const count = Math.abs(Math.round(target - initial));
    const direction = target >= initial ? 1 : -1;
    const button = document.querySelector<HTMLButtonElement>(`.joint-jog-btn[data-joint-index="${index}"][data-joint-dir="${direction}"]`)!;
    for (let step = 0; step < count; step++) {
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 }));
      button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 }));
      if (!document.querySelector<HTMLElement>('#collision-toast')!.hidden) break;
    }
    return Number(output.textContent);
  }, { index, target });
}
