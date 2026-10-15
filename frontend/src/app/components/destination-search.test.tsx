import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DestinationSearch } from './destination-search'
import type { LocationSuggestion } from '../../api/geocode'

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
}: {
  initialValue?: string
  onSelect: (suggestion: LocationSuggestion) => void
  onSubmit: () => void
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
})
