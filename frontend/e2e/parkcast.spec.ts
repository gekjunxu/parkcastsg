import { expect, test } from '@playwright/test'

const rawCarpark = {
  id: 'URA_A0004',
  name: 'Pasir Ris Mall',
  address: '1 Pasir Ris Central',
  lat: 1.3721,
  lng: 103.9496,
  available_lots: 0,
  total_lots: 120,
  lot_types: [{ lot_type: 'C', available_lots: 0, total_lots: 120 }],
  crowd_level: 'unknown',
  is_sheltered: null,
  distance: 160,
  night_parking: null,
  car_park_type: 'CAR PARK',
  source: 'ura',
  weekdays_rate_1: null,
  weekdays_rate_2: null,
  saturday_rate: null,
  sunday_ph_rate: null,
  free_parking: '',
  short_term_parking: '',
  is_central: false,
  is_peak: false,
  availability_timestamp: null,
}

test('searches a destination, opens a carpark, and shows static availability honestly', async ({ page }) => {
  await page.route('**/api/v1/locations/suggest*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        label: 'Pasir Ris Mall',
        address: '1 Pasir Ris Central',
        postal: '519599',
        lat: 1.3721,
        lng: 103.9496,
      }]),
    })
  })
  await page.route('**/api/v1/weather*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        area: 'Pasir Ris',
        forecast: 'Fair',
        is_raining: false,
        valid_period: '10am–12pm',
      }),
    })
  })
  await page.route('**/api/v1/carparks/nearby*', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([rawCarpark]) })
  })
  await page.route('**/api/v1/carparks/URA_A0004*', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rawCarpark) })
  })

  await page.goto('/')
  const search = page.getByRole('combobox', { name: 'Destination or postal code' })
  await search.fill('Pasir Ris Mall')
  await expect(page.getByRole('option')).toContainText('Pasir Ris Mall')
  await page.getByRole('option').click()

  await expect(page).toHaveURL(/\/results\?/)
  await expect(page.getByRole('button', { name: 'Show Pasir Ris Mall on map' })).toBeVisible()

  await page.getByRole('button', { name: 'Show Pasir Ris Mall on map' }).click()
  await page.getByRole('button', { name: 'Details & rates' }).click()
  await expect(page).toHaveURL(/\/carpark\/URA_A0004/)
  await expect(page.getByRole('heading', { name: 'Pasir Ris Mall' })).toBeVisible()
  await expect(page.getByText('Availability not tracked')).toBeVisible()
})
