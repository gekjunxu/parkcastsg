import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router'
import { ArrowLeft, Search, SlidersHorizontal, Navigation, List, Map as MapIcon, X, RefreshCw, ChevronUp, ChevronDown, CloudRain } from 'lucide-react'
import { CarparkCard } from '../components/carpark-card'
import { CarparkMap } from '../components/carpark-map'
import { FilterChips } from '../components/filter-chips'
import { LoadingSkeleton } from '../components/loading-skeleton'
import { NavigationChooserModal } from '../components/navigation-chooser-modal'
import { sortCarparks, filterShelteredCarparks, getAvailabilityText, type Carpark } from '../data/carparks'
import { geocodeQuery, type Coordinates } from '../../api/geocode'
import { getNearbyCarparks, getAllCarparks, getCarparksInArea, transformCarpark } from '../../api/carparkService'
import { getUserLocation } from '../../api/geolocation'
import { getWeatherForecast, type WeatherData } from '../../api/weatherService'
import { calculateLiveRates } from '../utils/pricingEngine'
import { areaFromParams, areaSearchUrl, canSearchViewport, carparksInViewport, type MapViewport } from '../utils/mapViewport'
import '../../styles/parking-map.css'

const SG = { lat: 1.3521, lng: 103.8198 }
const PAGE_SIZE = 30
type ViewMemory = { viewport: MapViewport | null; selected: string | null; listOpen: boolean; sort: 'recommended' | 'cheapest' | 'closest' | 'available'; rainMode: boolean }
const savedViews = new Map<string, ViewMemory>()
// Reuse the island-wide response across detail/back navigation. Nearby searches
// never pay this network or marker cost. Explicit refresh bypasses this cache.
let explorerCache: { data: Carpark[]; fetchedAt: number } | null = null
let explorerRequest: Promise<Carpark[]> | null = null
async function loadExplorer(force: boolean) {
  if (!force && explorerCache && Date.now() - explorerCache.fetchedAt < 60_000) return explorerCache
  if (!explorerRequest) {
    explorerRequest = getAllCarparks().then(raw => {
      const data = raw.map(transformCarpark)
      explorerCache = { data, fetchedAt: Date.now() }
      return data
    }).finally(() => { explorerRequest = null })
  }
  await explorerRequest
  return explorerCache!
}

export function ResultsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const saved = useRef(savedViews.get(location.key)).current
  const [params] = useSearchParams()
  const browsing = location.pathname === '/map'
  const queryKey = params.toString()
  const searchArea = areaFromParams(params)
  const destination = params.get('q') || ''
  const parsedLat = Number(params.get('lat')), parsedLng = Number(params.get('lng'))
  const hasCoords = params.has('lat') && params.has('lng') && Number.isFinite(parsedLat) && Number.isFinite(parsedLng) && Math.abs(parsedLat) <= 90 && Math.abs(parsedLng) <= 180
  const radius = [300, 500, 1000, 2000].includes(Number(params.get('radius'))) ? Number(params.get('radius')) : 1000
  const initialCenter = hasCoords ? { lat: parsedLat, lng: parsedLng } : SG
  const initialZoom = searchArea?.zoom ?? (browsing ? Math.max(10, Math.min(18, Number(params.get('zoom')) || 12)) : 15)
  const [query, setQuery] = useState(destination)
  const [data, setData] = useState<Carpark[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [updated, setUpdated] = useState<number | null>(null)
  const [selected, setSelected] = useState<string | null>(saved?.selected ?? null)
  const [sort, setSort] = useState<'recommended' | 'cheapest' | 'closest' | 'available'>(saved?.sort ?? 'recommended')
  const [rainMode, setRainMode] = useState(saved?.rainMode ?? false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [listOpen, setListOpen] = useState(saved?.listOpen ?? false)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [viewport, setViewport] = useState<MapViewport | null>(saved?.viewport ?? null)
  const [moved, setMoved] = useState(false)
  const [target, setTarget] = useState({ center: saved?.viewport?.center ?? initialCenter, zoom: saved?.viewport?.zoom ?? initialZoom, revision: 0 })
  const [searchCoords, setSearchCoords] = useState<Coordinates | null>(hasCoords ? initialCenter : null)
  const [userLocation, setUserLocation] = useState<Coordinates | null>(!browsing && hasCoords && !destination ? initialCenter : null)
  const [accuracy, setAccuracy] = useState(Number(params.get('accuracy')) || undefined)
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [navigationOpen, setNavigationOpen] = useState(false)
  const swipeStart = useRef<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const requestId = useRef(0)
  const focusedSearch = useRef(saved ? `${browsing ? 'map' : 'search'}:${queryKey}` : '')
  const viewSnapshot = useRef<ViewMemory>({ viewport, selected, listOpen, sort, rainMode })
  viewSnapshot.current = { viewport, selected, listOpen, sort, rainMode }

  useEffect(() => { setQuery(destination) }, [destination])
  useEffect(() => {
    const id = ++requestId.current
    let cancelled = false
    const controller = new AbortController()
    setLoading(true); setError(null); setWeather(null); setLimit(PAGE_SIZE)
    setSelected(savedViews.get(location.key)?.selected ?? null)
    setData([])
    async function load() {
      try {
        if (browsing) {
          if (focusedSearch.current !== `map:${queryKey}`) {
            setTarget(t => ({ center: initialCenter, zoom: initialZoom, revision: t.revision + 1 }))
            focusedSearch.current = `map:${queryKey}`
          }
          const result = await loadExplorer(refresh > 0)
          if (cancelled) return
          setData(result.data); setUpdated(result.fetchedAt)
        } else {
          const coords = hasCoords ? { lat: parsedLat, lng: parsedLng } : await geocodeQuery(destination)
          if (cancelled) return
          if (!coords) throw new Error('Location not found. Try a Singapore address or postal code.')
          setSearchCoords(coords)
          if (focusedSearch.current !== `search:${queryKey}`) {
            setTarget(t => ({ center: coords, zoom: searchArea?.zoom ?? (radius <= 500 ? 16 : radius <= 1000 ? 15 : 14), revision: t.revision + 1 }))
            focusedSearch.current = `search:${queryKey}`
          }
          // Weather must never delay the parking results.
          getWeatherForecast(coords.lat, coords.lng).then(w => {
            if (!cancelled) { setWeather(w); if (w.isRaining) setRainMode(true) }
          }).catch(() => { /* Weather is optional. Parking remains usable. */ })
          const raw = searchArea
            ? await getCarparksInArea(searchArea, controller.signal)
            : await getNearbyCarparks(coords.lat, coords.lng, radius, controller.signal)
          if (cancelled) return
          setData(raw.map(transformCarpark)); setUpdated(Date.now())
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error && err.message.startsWith('Location not found') ? err.message : 'Carparks could not be loaded. Check your connection and try again.')
      } finally {
        if (!cancelled && id === requestId.current) { setLoading(false); setMoved(false) }
      }
    }
    load()
    return () => { cancelled = true; controller.abort() }
  }, [browsing, queryKey, refresh])

  const pins = useMemo(() => rainMode ? filterShelteredCarparks(data) : data, [data, rainMode])
  const results = useMemo(() => sortCarparks(browsing && viewport ? carparksInViewport(pins, viewport) : pins, sort), [pins, browsing, viewport, sort])
  const chosen = pins.find(cp => cp.id === selected) ?? null
  useEffect(() => { setLimit(PAGE_SIZE); listRef.current?.scrollTo(0, 0) }, [viewport, sort, rainMode, queryKey])
  useEffect(() => { if (!loading && selected && !chosen) setSelected(null) }, [loading, selected, chosen])
  const onPinClick = useCallback((id: string) => { setSelected(id); setListOpen(false) }, [])
  const onMapMoved = useCallback(() => setMoved(true), [])

  function search(event: React.FormEvent) {
    event.preventDefault()
    if (!query.trim()) return
    setFiltersOpen(false); setListOpen(false)
    navigate(`/results?q=${encodeURIComponent(query.trim())}&radius=${radius}`)
  }
  function explore(reset = false) {
    setFiltersOpen(false); setListOpen(false)
    if (!reset && viewport) {
      if (!canSearchViewport(viewport)) return
      navigate(areaSearchUrl(viewport))
      return
    }
    const center = reset ? SG : viewport?.center ?? target.center
    const zoom = reset ? 12 : viewport?.zoom ?? target.zoom
    setTarget(t => ({ center, zoom, revision: t.revision + 1 }))
    navigate(`/map?lat=${center.lat}&lng=${center.lng}&zoom=${zoom}`)
  }
  async function handleUseLocation() {
    setLocating(true); setLocationError(null)
    try {
      const coords = await getUserLocation()
      setUserLocation(coords); setAccuracy(coords.accuracy); setListOpen(false)
      navigate(`/results?lat=${coords.lat}&lng=${coords.lng}&accuracy=${Math.round(coords.accuracy)}&radius=${radius}`)
    } catch (err) { setLocationError(err instanceof Error ? err.message : 'Could not find your location. Search by address instead.') }
    finally { setLocating(false) }
  }
  function changeRadius(value: number) {
    const next = new URLSearchParams(params)
    for (const key of ['north', 'south', 'east', 'west', 'zoom']) next.delete(key)
    next.set('radius', String(value))
    navigate(`/results?${next}`)
  }
  function viewDetails(id: string) {
    savedViews.set(location.key, { ...viewSnapshot.current, selected: id })
    if (savedViews.size > 20) savedViews.delete(savedViews.keys().next().value!)
    const coords = browsing ? viewport?.center : searchCoords
    navigate(`/carpark/${encodeURIComponent(id)}${coords ? `?lat=${coords.lat}&lng=${coords.lng}` : ''}`)
  }
  function selectFromList(cp: Carpark) {
    setSelected(cp.id); setListOpen(false)
    setTarget(t => ({ center: { lat: cp.lat, lng: cp.lng }, zoom: 18, revision: t.revision + 1 }))
  }
  const title = browsing ? 'Explore Singapore' : destination || 'Near your location'
  const subtitle = browsing ? 'in this map area' : searchArea ? 'in the searched map area' : `within ${radius >= 1000 ? `${radius / 1000}km` : `${radius}m`}`

  return <main className={`parking-shell${listOpen ? ' list-open' : ''}${chosen ? ' has-selection' : ''}`}>
    <header className="parking-header">
      <form onSubmit={search} className="parking-search">
        <button type="button" className="parking-icon-button" onClick={() => navigate('/')} aria-label="Back to home"><ArrowLeft size={20} /></button>
        <label className="parking-search-input"><Search size={18} /><input aria-label="Search destination or postal code" placeholder="Destination or postal code" value={query} onChange={e => setQuery(e.target.value)} enterKeyHint="search" /></label>
        <button type="submit" className="parking-search-submit" disabled={!query.trim()} aria-label="Search carparks"><Search size={20} /></button>
      </form>
      <div className="parking-toolbar">
        <div className="parking-context"><strong>{title}</strong><span>{browsing || searchArea ? 'Pan to discover parking' : `${radius >= 1000 ? `${radius / 1000}km` : `${radius}m`} around destination`}</span></div>
        <button className={`parking-tool${rainMode ? ' active' : ''}`} onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen} aria-controls="parking-filters"><SlidersHorizontal size={18} /><span>Filters{rainMode ? ' · 1' : ''}</span></button>
        <button className="parking-icon-button" onClick={handleUseLocation} disabled={locating} aria-label={locating ? 'Finding your location' : 'Use my location'}><Navigation size={20} className={locating ? 'animate-pulse' : ''} /></button>
      </div>
      {filtersOpen && <section id="parking-filters" className="parking-filters" aria-label="Parking filters">
        {!browsing && !searchArea && <div className="parking-radius" role="group" aria-label="Search radius">{[300, 500, 1000, 2000].map(r => <button key={r} onClick={() => changeRadius(r)} aria-pressed={radius === r}>{r >= 1000 ? `${r / 1000}km` : `${r}m`}</button>)}</div>}
        <FilterChips selectedFilter={sort} rainMode={rainMode} onFilterChange={setSort} onRainModeToggle={() => setRainMode(v => !v)} />
        <p>{browsing ? 'Closest is measured from the centre of the map. ' : ''}Rain mode excludes known open-air carparks.</p>
        {!browsing && <button className="parking-text-button" onClick={() => explore(true)}>Explore all Singapore carparks</button>}
        <button className="parking-text-button" onClick={() => setFiltersOpen(false)}>Done</button>
      </section>}
      {weather?.isRaining && <div className="parking-weather"><CloudRain size={16} /><span>{weather.forecast} · {weather.area}{rainMode ? ' · Rain mode on' : ''}</span><button onClick={() => setWeather(null)} aria-label="Dismiss weather"><X size={16} /></button></div>}
      {locationError && <div className="parking-notice" role="alert">{locationError}<button onClick={() => setLocationError(null)} aria-label="Dismiss location error"><X size={18} /></button></div>}
    </header>

    <div className="parking-workspace">
      <div className="parking-map-area">
        <CarparkMap carparks={pins} clusterCarparks={browsing} selectedCarparkId={selected} onPinClick={onPinClick} userLocation={userLocation} userAccuracy={accuracy} searchLocation={browsing || searchArea ? null : searchCoords} searchRadius={radius} target={target} onViewportChange={setViewport} onMapMoved={onMapMoved} />
        {!browsing && moved && !loading && <button className="parking-search-area" disabled={!viewport || !canSearchViewport(viewport)} onClick={() => explore()}><Search size={16} />{viewport && canSearchViewport(viewport) ? 'Search this area' : 'Zoom in to search this area'}</button>}
        {browsing && !loading && !error && <div className="parking-map-hint">Tap a group to zoom · Pins show available lots</div>}
        {loading && <div className="parking-map-status" role="status"><RefreshCw size={16} className="animate-spin" />Loading carparks…</div>}
      </div>

      <section className="parking-results" aria-label="Carpark results">
        <div className="parking-sheet-handle" onPointerDown={e => { swipeStart.current = e.clientY; e.currentTarget.setPointerCapture(e.pointerId) }} onPointerUp={e => {
          if (swipeStart.current !== null && Math.abs(e.clientY - swipeStart.current) > 25) setListOpen(e.clientY < swipeStart.current)
          swipeStart.current = null
        }}><button aria-label={listOpen ? 'Collapse carpark list' : 'Expand carpark list'} onClick={() => setListOpen(!listOpen)}><span /></button></div>
        <div className="parking-results-heading">
          <div aria-live="polite"><h1>{loading ? 'Finding parking…' : error ? 'Unable to load carparks' : `${results.length} carparks`}</h1><p>{subtitle}</p></div>
          <button className="parking-icon-button" aria-label="Refresh availability" disabled={loading} onClick={() => setRefresh(v => v + 1)}><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
          <button className="parking-view-toggle" onClick={() => setListOpen(!listOpen)}>{listOpen ? <MapIcon size={18} /> : <List size={18} />}{listOpen ? 'Map' : 'List'}{listOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</button>
        </div>
        {error && <div className="parking-empty" role="alert"><p>{error}</p><button onClick={() => setRefresh(v => v + 1)}>Try again</button></div>}
        {!loading && !error && results.length === 0 && <div className="parking-empty"><p>No carparks {subtitle}{rainMode ? ' with this filter' : ''}.</p>{rainMode && <button onClick={() => setRainMode(false)}>Remove rain filter</button>}{!browsing && <button onClick={() => explore()}>Explore the map</button>}{browsing && <p>Pan or zoom out to see more parking.</p>}</div>}
        {chosen && <div className="parking-selection">
          <div className="parking-selection-title"><h2>{chosen.name}</h2><button className="parking-icon-button" onClick={() => setSelected(null)} aria-label="Close selected carpark"><X size={18} /></button></div>
          <p className="parking-selection-address">{chosen.address}</p>
          <div className="parking-selection-facts"><strong>{calculateLiveRates(chosen).car}</strong><span>{getAvailabilityText(chosen)}</span></div>
          <div className="parking-selection-actions"><button onClick={() => viewDetails(chosen.id)}>Details & rates</button><button onClick={() => setNavigationOpen(true)}><Navigation size={16} />Directions</button></div>
        </div>}
        <div className="parking-result-list" ref={listRef}>
          {loading ? <LoadingSkeleton count={3} /> : !error && <>
            {results.slice(0, limit).map(cp => <CarparkCard key={cp.id} carpark={cp} isSelected={selected === cp.id} showRainIcon={rainMode} hideDistance={browsing} onClick={() => selectFromList(cp)} onViewDetails={() => viewDetails(cp.id)} />)}
            {results.length > limit && <button className="parking-load-more" onClick={() => setLimit(v => v + PAGE_SIZE)}>Show more carparks ({results.length - limit} remaining)</button>}
            {updated && <p className="parking-freshness">Fetched at {new Date(updated).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })} · HDB / LTA<br />Some carparks do not publish live availability.</p>}
          </>}
        </div>
      </section>
    </div>
    {chosen && <NavigationChooserModal isOpen={navigationOpen} onClose={() => setNavigationOpen(false)} lat={chosen.lat} lng={chosen.lng} address={chosen.address} />}
  </main>
}
