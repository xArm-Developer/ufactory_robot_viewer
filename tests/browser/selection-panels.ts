import type { Page } from '@playwright/test';

export async function selectRobot(page: Page, id: string) {
  await page.locator('#robot-select').selectOption(id);
}

export async function selectRail(page: Page, id: string) {
  await page.locator('#rail-toggle').setChecked(id === 'al0700');
}

export async function viewStandalone(page: Page, id: string) {
  await page.locator(`[data-standalone-view="${id}"]`).click();
}

export async function returnToAssembly(page: Page) {
  await page.locator('#return-assembly').click();
}
