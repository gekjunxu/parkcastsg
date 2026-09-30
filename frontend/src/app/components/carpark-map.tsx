import { memo, useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Circle, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.markercluster'
import { LocateFixed, Plus, Minus, Info } from 'lucide-react'
import { type Carpark, getAvailabilityColor } from '../data/carparks'
import type { Coordinates } from '../../api/geocode'
import type { MapViewport } from '../utils/mapViewport'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'

interface CarparkMapProps {
  carparks: Carpark[]
  selectedCarparkId: string | null
  onPinClick: (id: string) => void
  userLocation?: Coordinates | null
  userAccuracy?: number
  searchLocation?: Coordinates | null
  searchRadius?: number
  target: { center: Coordinates; zoom: number; revision: number }
  onViewportChange: (viewport: MapViewport) => void
  onMapMoved: () => void
}

function pinIcon(cp: Carpark, selected = false) {
  // Numeric or constant labels only: never interpolate API text into marker HTML.
  const label = cp.availabilityLevel === 'unknown' ? 'P' : String(cp.availableLots)
  return L.divIcon({
    className: `parking-pin${selected ? ' is-selected' : ''}`,
    html: `<span style="--pin-color:${getAvailabilityColor(cp.availabilityLevel)}">${label}</span>`,
    iconSize: [44, 44], iconAnchor: [22, 22],
  })
}

/** One batched Leaflet layer, rather than thousands of React markers/popups. */
const ParkingPins = memo(function ParkingPins({ carparks, selectedCarparkId, onPinClick }: Pick<CarparkMapProps, 'carparks' | 'selectedCarparkId' | 'onPinClick'>) {
  const map = useMap()
  const markers = useRef(new Map<string, L.Marker>())
  const onClick = useRef(onPinClick)
  onClick.current = onPinClick
  useEffect(() => {
    const started = performance.now()
    const cluster = L.markerClusterGroup({
      chunkedLoading: true, chunkInterval: 40, chunkDelay: 16,
      removeOutsideVisibleBounds: true, showCoverageOnHover: false,
      maxClusterRadius: 52, animate: false,
      // Nearby searches start at zoom 15: show each carpark at its own location.
      // A fixed cutoff avoids building clusters for the closer zoom levels.
      disableClusteringAtZoom: 15,
      chunkProgress: (processed, total) => {
        if (import.meta.env.DEV && processed === total) console.debug(`Parking map: ${total} markers prepared in ${Math.round(performance.now() - started)}ms`)
      },
      iconCreateFunction: group => L.divIcon({
        className: 'parking-cluster',
        html: `<span>${group.getChildCount()}</span><small>carparks</small>`,
        iconSize: [56, 56],
      }),
    })
    const pins = carparks.filter(cp => Number.isFinite(cp.lat) && Number.isFinite(cp.lng)).map(cp => {
      const marker = L.marker([cp.lat, cp.lng], { icon: pinIcon(cp), title: cp.name, alt: `${cp.name}: ${cp.availabilityLevel === 'unknown' ? 'availability not tracked' : `${cp.availableLots} lots`}`, riseOnHover: true })
      marker.on('click', () => onClick.current(cp.id))
      marker.on('add', () => marker.getElement()?.setAttribute('aria-label', `${cp.name}: ${cp.availabilityLevel === 'unknown' ? 'availability not tracked' : `${cp.availableLots} lots available`}`))
      markers.current.set(cp.id, marker)
      return marker
    })
    // Batch insertion; avoid mounting a React subtree for every carpark.
    map.addLayer(cluster)
    cluster.addLayers(pins)
    return () => { map.removeLayer(cluster); cluster.clearLayers(); markers.current.clear() }
  }, [map, carparks])

  useEffect(() => {
    if (!selectedCarparkId) return
    const cp = carparks.find(cp => cp.id === selectedCarparkId)
    const marker = markers.current.get(selectedCarparkId)
    if (!cp || !marker) return
    marker.setIcon(pinIcon(cp, true))
    marker.setZIndexOffset(1000)
    map.panInside(marker.getLatLng(), { paddingTopLeft: L.point(35, 60), paddingBottomRight: L.point(65, window.innerWidth < 1024 ? Math.min(300, map.getSize().y * 0.49) : 35), animate: false })
    return () => { marker.setIcon(pinIcon(cp)); marker.setZIndexOffset(0) }
  }, [carparks, selectedCarparkId, map])
  return null
})

function MapEvents({ target, onViewportChange, onMapMoved }: Pick<CarparkMapProps, 'target' | 'onViewportChange' | 'onMapMoved'>) {
  const map = useMap()
  const callbacks = useRef({ onViewportChange, onMapMoved })
  callbacks.current = { onViewportChange, onMapMoved }
  useEffect(() => {
    const report = () => {
      const b = map.getBounds(), c = map.getCenter()
      callbacks.current.onViewportChange({ north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest(), center: { lat: c.lat, lng: c.lng }, zoom: map.getZoom() })
    }
    const moved = () => callbacks.current.onMapMoved()
    map.on('moveend', report)
    map.on('dragstart', moved)
    map.on('zoomend', moved)
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }))
    observer.observe(map.getContainer())
    report()
    return () => { map.off('moveend', report); map.off('dragstart', moved); map.off('zoomend', moved); observer.disconnect() }
  }, [map])
  useEffect(() => {
    map.setView([target.center.lat, target.center.lng], target.zoom, { animate: false })
  }, [map, target])
  return null
}

export const CarparkMap = memo(function CarparkMap(props: CarparkMapProps) {
  const mapRef = useRef<L.Map>(null)
  const [legend, setLegend] = useState(false)
  return <div className="parking-map" aria-label="Carpark map">
    <MapContainer center={[props.target.center.lat, props.target.center.lng]} zoom={props.target.zoom} className="h-full w-full" zoomControl={false} ref={mapRef}>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <MapEvents {...props} />
      <ParkingPins carparks={props.carparks} selectedCarparkId={props.selectedCarparkId} onPinClick={props.onPinClick} />
      {props.searchLocation && <>
        <Circle center={props.searchLocation} radius={props.searchRadius ?? 1000} pathOptions={{ color: '#2563eb', weight: 1, dashArray: '5 6', fillOpacity: 0.025 }} interactive={false} />
        <CircleMarker center={props.searchLocation} radius={7} pathOptions={{ color: 'white', weight: 3, fillColor: '#1a56db', fillOpacity: 1 }}><Tooltip>Search destination</Tooltip></CircleMarker>
      </>}
      {props.userLocation && <>
        {props.userAccuracy && Number.isFinite(props.userAccuracy) && props.userAccuracy > 0 && <Circle center={props.userLocation} radius={props.userAccuracy} pathOptions={{ color: '#2563eb', weight: 1, fillOpacity: 0.08 }} />}
        <Marker position={props.userLocation} icon={L.divIcon({ className: 'parking-user-location', iconSize: [18, 18], iconAnchor: [9, 9] })} title="Your location" />
      </>}
    </MapContainer>
    <div className="parking-map-controls">
      <button onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in"><Plus size={20} /></button>
      <button onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out"><Minus size={20} /></button>
      <button onClick={() => mapRef.current?.setView(props.target.center, props.target.zoom)} aria-label="Recenter map"><LocateFixed size={20} /></button>
      <button onClick={() => setLegend(!legend)} aria-label="Map legend" aria-expanded={legend}><Info size={20} /></button>
    </div>
    {legend && <div className="parking-legend">
      <strong>Lots available</strong>
      <span><i style={{ background: '#10B981' }} /> High</span>
      <span><i style={{ background: '#F59E0B' }} /> Moderate / low</span>
      <span><i style={{ background: '#EF4444' }} /> Full</span>
      <span><i style={{ background: '#9CA3AF' }} /> P · Not tracked</span>
      <small>Zoomed-out groups show carpark counts. Zoom in to see individual carparks.</small>
    </div>}
  </div>
})
