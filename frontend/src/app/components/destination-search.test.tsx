import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DestinationSearch, type DestinationSearchVariant } from './destination-search'
import type { LocationSuggestion } from '../../api/geocode'

const parkingMapStylesheet = readFileSync(
  resolve(process.cwd(), 'src/styles/parking-map.css'),
  'utf8',
)
const destinationSearchStylesheet = readFileSync(
  resolve(process.cwd(), 'src/styles/destination-search.css'),
  'utf8',
)

const homePageSource = readFileSync(
  resolve(process.cwd(), 'src/app/pages/home-page.tsx'),
  'utf8',
)

const suggestion: LocationSuggestion = {
  label: 'Marina Bay Sands',
  address: '10 Bayfront Avenue',
  postal: '018956',
  lat: 1.2834,
  lng: 103.8607,
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function ControlledSearch({
  initialValue = '',
  onSelect,
  onSubmit,
  leadingIcon,
  variant,
}: {
  initialValue?: string
  onSelect: (suggestion: LocationSuggestion) => void
  onSubmit: () => void
  leadingIcon?: ReactNode
  variant?: DestinationSearchVariant
}) {
  const [value, setValue] = useState(initialValue)
  return (
    <DestinationSearch
      value={value}
      onChange={setValue}
      onSelect={onSelect}
      onSubmit={onSubmit}
      inputLabel="Destination"
      placeholder="Search"
      leadingIcon={leadingIcon}
      variant={variant}
    />
  )
}

describe('DestinationSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([suggestion])))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('debounces suggestions and selects the active option with Enter', async () => {
    const onSelect = vi.fn()
    const onSubmit = vi.fn()
    render(
      <ControlledSearch
        onSelect={onSelect}
        onSubmit={onSubmit}
      />,
    )
    const input = screen.getByRole('combobox')

    await act(async () => {
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: 'marina' } })
      await Promise.resolve()
    })
    expect(fetch).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(249) })
    expect(fetch).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(fetch).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.runAllTimersAsync(); await Promise.resolve() })

    const option = screen.getByRole('option')
    expect(option.textContent).toContain('Marina Bay Sands')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.getAttribute('aria-activedescendant')).toBe(option.id)
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledWith(suggestion)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('closes suggestions on blur', async () => {
    render(
      <ControlledSearch
        onSelect={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )
    const input = screen.getByRole('combobox')

    await act(async () => {
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: 'ma' } })
      await vi.advanceTimersByTimeAsync(250)
      await vi.runAllTimersAsync()
    })
    expect(screen.getByRole('option')).toBeTruthy()

    fireEvent.blur(input)
    await act(async () => { await vi.runAllTimersAsync() })
    expect(screen.queryByRole('option')).toBeNull()
  })

  it('supports mouse selection', async () => {
    const onSelect = vi.fn()
    render(
      <ControlledSearch
        onSelect={onSelect}
        onSubmit={vi.fn()}
      />,
    )
    const input = screen.getByRole('combobox')
    await act(async () => {
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: 'marina' } })
      await Promise.resolve()
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(249) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    await act(async () => { await vi.runAllTimersAsync(); await Promise.resolve() })
    fireEvent.mouseDown(screen.getByRole('option'))
    expect(onSelect).toHaveBeenCalledWith(suggestion)
  })

  it('submits text when Enter has no active suggestion and ignores IME Enter', () => {
    const onSubmit = vi.fn()
    render(
      <ControlledSearch
        initialValue="marina"
        onSelect={vi.fn()}
        onSubmit={onSubmit}
      />,
    )
    const input = screen.getByRole('combobox')
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('clears a non-empty search with an X button and keeps the input focused', () => {
    render(
      <ControlledSearch
        initialValue="marina"
        onSelect={vi.fn()}
        onSubmit={vi.fn()}
      />
    )
    const input = screen.getByRole('combobox')
    input.focus()

    const clearButton = screen.getByRole('button', { name: 'Clear search' })
    fireEvent.mouseDown(clearButton)
    fireEvent.click(clearButton)

    expect(input).toHaveProperty('value', '')
    expect(document.activeElement).toBe(input)
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
  })

  it('uses a rounded focus ring instead of the global rectangular outline', () => {
    render(
      <ControlledSearch
        onSelect={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )
    const input = screen.getByRole('combobox')

    expect(input.className).toContain('destination-search-input')
    expect(destinationSearchStylesheet).toMatch(
      /\.parking-search-input:focus-within\s*\{[^}]*outline:\s*3px\s+solid\s+#2563eb;[^}]*outline-offset:\s*2px;/s,
    )
    expect(destinationSearchStylesheet).toMatch(
      /\.parking-shell\s+input\.destination-search-input:focus-visible\s*\{[^}]*outline:\s*none;[^}]*outline-offset:\s*0;[^}]*box-shadow:\s*none;/s,
    )
  })

  it('inherits shared input appearances for standalone and embedded fields', () => {
    render(
      <div>
        <ControlledSearch
          variant="standalone"
          onSelect={vi.fn()}
          onSubmit={vi.fn()}
        />
        <ControlledSearch
          variant="embedded"
          onSelect={vi.fn()}
          onSubmit={vi.fn()}
        />
      </div>,
    )
    const inputs = screen.getAllByRole('combobox')
    const standaloneInput = inputs[0]
    const embeddedInput = inputs[1]

    expect(standaloneInput.className).toContain('destination-search-input--standalone')
    expect(standaloneInput.className).toContain('border-input')
    expect(standaloneInput.className).toContain('focus-visible:ring-[3px]')
    expect(embeddedInput.className).toContain('destination-search-input--embedded')
    expect(embeddedInput.className).toContain('border-0')
    expect(embeddedInput.className).toContain('focus-visible:ring-0')
    expect(destinationSearchStylesheet).not.toMatch(/\.destination-search-input--standalone\s*\{/)
    expect(homePageSource).toMatch(
      /<DestinationSearch[\s\S]*variant='standalone'[\s\S]*className='w-full pr-4 py-6 text-base rounded-lg'/s,
    )
  })


  it('keeps leading icons inside the reusable destination field', () => {
    render(
      <ControlledSearch
        leadingIcon={<span data-testid="leading-icon" />}
        onSelect={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )
    const input = screen.getByRole('combobox')
    const field = input.closest('.destination-search')

    expect(screen.getByTestId('leading-icon')).toBeTruthy()
    expect(field?.className).toContain('destination-search--with-leading-icon')
    expect(destinationSearchStylesheet).toMatch(
      /\.destination-search-leading-icon\s*\{[^}]*pointer-events:\s*none;/s,
    )
    expect(homePageSource).toMatch(
      /<DestinationSearch[\s\S]*leadingIcon=\{<MapPin[\s\S]*variant='standalone'[\s\S]*className='w-full pr-4 py-6 text-base rounded-lg'/s,
    )
  })

  it('ignores a late response from an older query and aborts on unmount', async () => {
    const pending: Array<(response: Response) => void> = []
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      let resolveRequest!: (response: Response) => void
      const request = new Promise<Response>((resolve) => {
        resolveRequest = resolve
        void init
      })
      pending.push(resolveRequest)
      return request
    })
    vi.stubGlobal('fetch', fetchMock)
    const view = render(
      <ControlledSearch
        onSelect={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )
    const input = screen.getByRole('combobox')
    await act(async () => {
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: 'ma' } })
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(250)
    })
    await act(async () => {
      fireEvent.change(input, { target: { value: 'mar' } })
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      pending[1](jsonResponse([{ ...suggestion, label: 'New result' }]))
      pending[0](jsonResponse([{ ...suggestion, label: 'Old result' }]))
      await Promise.resolve()
    })
    expect(screen.getByRole('option').textContent).toContain('New result')
    expect(screen.getByRole('option').textContent).not.toContain('Old result')

    await act(async () => {
      fireEvent.change(input, { target: { value: 'mari' } })
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(250)
    })
    const signal = (fetchMock.mock.calls[2][1] as RequestInit).signal
    view.unmount()
    expect(signal?.aborted).toBe(true)
  })

  it('gives the home location action hover, pressed, and keyboard feedback', () => {
    const locationButton = homePageSource.match(
      /<button[\s\S]*?onClick=\{handleUseLocation\}[\s\S]*?className='([^']+)'/,
    )?.[1]

    expect(locationButton).toContain('hover:bg-blue-50')
    expect(locationButton).toContain('active:bg-blue-100')
    expect(locationButton).toContain('focus-visible:ring-2')
    expect(locationButton).toContain('cursor-pointer')
  })

  it('keeps the autocomplete stacking context above the results sheet', () => {
    const style = document.createElement('style')
    style.textContent = parkingMapStylesheet
    document.head.append(style)

    const header = document.createElement('header')
    header.className = 'parking-header'
    const results = document.createElement('section')
    results.className = 'parking-results'
    document.body.append(header, results)

    const headerZIndex = Number.parseInt(getComputedStyle(header).zIndex, 10)
    const resultsZIndex = Number.parseInt(getComputedStyle(results).zIndex, 10)

    expect(headerZIndex).toBeGreaterThan(resultsZIndex)
    style.remove()
  })
})


