import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CarparkMap } from './carpark-map'
import type { CarparkMapProps } from './carpark-map'

vi.mock('react-leaflet', async () => {
  const React = await import('react')
  return {
    MapContainer: React.forwardRef(() => null),
    TileLayer: () => null,
    Marker: () => null,
    Circle: () => null,
    CircleMarker: () => null,
    Tooltip: () => null,
    useMap: () => ({}),
  }
})

vi.mock('leaflet.markercluster', () => ({}))

const mapProps: CarparkMapProps = {
  carparks: [],
  clusterCarparks: false,
  selectedCarparkId: null,
  onPinClick: vi.fn(),
  target: { center: { lat: 1.3, lng: 103.8 }, zoom: 12, revision: 0 },
  onViewportChange: vi.fn(),
  onMapMoved: vi.fn(),
}

describe('CarparkMap', () => {
  it('explains that P markers have no live availability data', () => {
    render(<CarparkMap {...mapProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'Map legend' }))

    expect(screen.getByText('P · Live availability unavailable')).toBeTruthy()
    expect(screen.queryByText('P · Not tracked')).toBeNull()
  })
})
