import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  memo,
} from 'react'
import { useNavigate } from 'react-router'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import { MarkerClusterGroup } from '../components/marker-cluster'
import L from 'leaflet'
import {
  Search,
  Navigation,
  X,
  MapPin,
  ArrowLeft,
  Layers,
  RotateCcw,
  LocateFixed,
  List,
  ChevronUp,
} from 'lucide-react'
import {
  getAllCarparks,
  getNearbyCarparks,
  transformCarpark,
} from '../../api/carparkService'
import { getUserLocation, GeolocationError } from '../../api/geolocation'
import {
  sortCarparks,
  filterShelteredCarparks,
  getAvailabilityColor,
  type Carpark,
} from '../data/carparks'
import { calculateLiveRates } from '../utils/pricingEngine'
import { CarparkCard } from '../components/carpark-card'
import { FilterChips } from '../components/filter-chips'
import { geocodeQuery } from '../../api/geocode'
import { Drawer, DrawerContent } from '../components/ui/drawer'
import 'leaflet/dist/leaflet.css'

// ─── Singapore Defaults ───────────────────────────────────────────────────────
const SG_CENTER: [number, number] = [1.3521, 103.8198]
const SG_ZOOM = 12
const SEARCH_ZOOM = 15
const CARPARK_ZOOM = 17

function formatLastUpdated(date: Date): string {
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000))
  if (seconds < 10) return 'Updated just now'
  if (seconds < 60) return `Updated ${seconds}s ago`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `Updated ${mins}m ago`
  const hours = Math.round(mins / 60)
  return `Updated ${hours}h ago`
}

// ─── Custom Icons ─────────────────────────────────────────────────────────────
function createPinIcon(color: string, isSelected: boolean) {
  const sz = isSelected ? 28 : 22
  const ring = isSelected ? 'border-blue-500' : 'border-white'
  return L.divIcon({
    className: 'custom-pin',
    html: `<div class="w-full h-full rounded-full border-[2.5px] shadow-sm transition-all duration-150 ${ring}" style="background-color: ${color}; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"></div>`,
    iconSize: [sz, sz],
    iconAnchor: [sz / 2, sz / 2],
  })
}

function createUserLocationIcon() {
  return L.divIcon({
    className: 'user-location-pin',
    html: `<div class="w-full h-full bg-blue-500 rounded-full border-[3px] border-white ring-4 ring-blue-500/20 shadow-md"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
}

// ─── Memoised Carpark Pin ──────────────────────────────────────────────────────
const CarparkPin = memo(function CarparkPin({
  carpark,
  isSelected,
  onPinClick,
}: {
  carpark: Carpark
  isSelected: boolean
  onPinClick: (id: string) => void
}) {
  const markerRef = useRef<L.Marker>(null)
  const color = getAvailabilityColor(carpark.availabilityLevel)
  const livePricing = calculateLiveRates(carpark)

  useEffect(() => {
    if (isSelected && markerRef.current) {
      setTimeout(() => markerRef.current?.openPopup(), 120)
    }
  }, [isSelected])

  return (
    <Marker
      position={[carpark.lat, carpark.lng]}
      icon={createPinIcon(color, isSelected)}
      ref={markerRef}
      eventHandlers={{ click: () => onPinClick(carpark.id) }}
    >
      <Popup className="carpark-popup custom-popup">
        <div className="text-sm">
          <p className="font-semibold mb-1 text-gray-900">{carpark.name}</p>
          <p className="text-gray-600 mb-2">
            {carpark.availabilityLevel === 'unknown'
              ? 'Live availability unavailable'
              : `${carpark.availableLots} / ${carpark.totalLots} lots available`}
          </p>
          <div className="space-y-1">
            <p className="text-gray-700 font-medium flex items-center gap-2">
              <span>🚗</span> {livePricing.car}
            </p>
            <p className="text-gray-700 font-medium flex items-center gap-2">
              <span>🏍️</span> {livePricing.motorcycle}
            </p>
            <p className="text-gray-700 font-medium flex items-center gap-2">
              <span>🚚</span> {livePricing.heavy}
            </p>
          </div>
        </div>
      </Popup>
    </Marker>
  )
})

// ─── Search Input Panel (isolated to prevent re-rendering map on each keystroke)
const SearchInput = memo(function SearchInput({
  isSearching,
  locationLoading,
  onSearch,
  onUseLocation,
}: {
  isSearching: boolean
  locationLoading: boolean
  onSearch: (q: string) => void
  onUseLocation: () => void
}) {
  const [query, setQuery] = useState('')

  return (
    <>
      <div className="relative mb-2.5">
        <Search
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          size={15}
        />
        <input
          type="text"
          className="w-full bg-white border border-gray-300 rounded-lg pl-9 pr-8 py-2.5 text-[13.5px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
          placeholder="Search destination or postal code…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query.trim()) onSearch(query.trim())
          }}
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 bg-white"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => { if (query.trim()) onSearch(query.trim()) }}
          disabled={isSearching || !query.trim()}
          className="flex-1 py-2 bg-[#1A56DB] text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm hover:bg-[#1444b8] disabled:opacity-50 transition-colors"
        >
          {isSearching
            ? <RotateCcw size={13} className="animate-spin" />
            : <Search size={13} />}
          Search
        </button>
        <button
          onClick={onUseLocation}
          disabled={locationLoading}
          className="py-2 px-3 bg-white border border-gray-300 rounded-lg text-gray-600 text-xs font-bold flex items-center gap-1.5 shadow-sm hover:bg-gray-50 transition-colors"
          title="Use my location"
        >
          <Navigation size={13} className={locationLoading ? 'animate-pulse text-blue-500' : ''} />
          <span>My location</span>
        </button>
      </div>
    </>
  )
})

const ExplorerPanelContent = memo(function ExplorerPanelContent({
  showBackButton,
  isDrawer,
  onBack,
  isSearching,
  locationLoading,
  onSearch,
  onUseLocation,
  searchError,
  isSearchMode,
  searchLabel,
  onClearSearch,
  searchRadius,
  onSearchRadiusChange,
  sortBy,
  rainMode,
  onSortChange,
  onRainModeToggle,
  isLoading,
  loadError,
  displayedCarparks,
  selectedCarpark,
  onCardClick,
  onViewDetails,
  allCarparksLength,
  freshnessText,
}: {
  showBackButton: boolean
  isDrawer: boolean
  onBack: () => void
  isSearching: boolean
  locationLoading: boolean
  onSearch: (q: string) => void
  onUseLocation: () => void
  searchError: string | null
  isSearchMode: boolean
  searchLabel: string | null
  onClearSearch: () => void
  searchRadius: number
  onSearchRadiusChange: (radius: number) => void
  sortBy: 'recommended' | 'cheapest' | 'closest' | 'available'
  rainMode: boolean
  onSortChange: (value: 'recommended' | 'cheapest' | 'closest' | 'available') => void
  onRainModeToggle: () => void
  isLoading: boolean
  loadError: string | null
  displayedCarparks: Carpark[]
  selectedCarpark: string | null
  onCardClick: (cp: Carpark) => void
  onViewDetails: (id: string) => void
  allCarparksLength: number
  freshnessText: string | null
}) {
  return (
    <>
      <div className={`p-4 border-b border-gray-200 shrink-0 ${isDrawer ? 'bg-white' : 'bg-gray-50/50'}`}>
        <div className="flex items-center gap-3 mb-3">
          {showBackButton && (
            <button
              onClick={onBack}
              className="p-1.5 rounded-lg bg-white border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
              title="Back to Home"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <div className="flex-1">
            <h1 className="text-lg font-bold text-gray-900 leading-tight">Map Explorer</h1>
            <p className="text-[11px] text-gray-500 font-medium">
              Singapore · Live HDB data and mapped LTA carparks
            </p>
            <p className="text-[10px] text-gray-400 font-medium mt-0.5">
              Some private/commercial carparks do not publish live lot counts.
            </p>
            {freshnessText && (
              <p className="text-[10px] text-gray-400 font-medium mt-0.5">{freshnessText}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1 border bg-blue-50 border-blue-100">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-blue-700">HDB live · LTA map</span>
          </div>
        </div>

        <SearchInput
          isSearching={isSearching}
          locationLoading={locationLoading}
          onSearch={onSearch}
          onUseLocation={onUseLocation}
        />

        {searchError && (
          <p className="text-[11px] text-red-500 font-medium mt-2">{searchError}</p>
        )}

        {isSearchMode && searchLabel && (
          <div className="mt-2.5 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg flex items-center gap-2">
            <MapPin size={13} className="text-blue-600 shrink-0" />
            <span className="text-[11.5px] text-blue-800 font-semibold flex-1 truncate">{searchLabel}</span>
            <button
              onClick={onClearSearch}
              className="text-blue-400 hover:text-blue-600 transition-colors"
              title="Clear search"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <div className="mt-2.5">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
            Search Radius
          </p>
          <div className="flex gap-1.5">
            {[300, 500, 1000, 2000].map((r) => (
              <button
                key={r}
                className={`flex-1 py-1.5 rounded-md text-[11px] font-bold transition-colors border ${
                  searchRadius === r
                    ? 'bg-[#1A56DB] text-white border-[#1A56DB] shadow-sm'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
                onClick={() => onSearchRadiusChange(r)}
              >
                {r >= 1000 ? `${r / 1000}km` : `${r}m`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-gray-200 shrink-0 bg-white">
        {isSearchMode ? (
          <FilterChips
            selectedFilter={sortBy}
            rainMode={rainMode}
            onFilterChange={onSortChange}
            onRainModeToggle={onRainModeToggle}
          />
        ) : (
          <div className="flex items-center gap-2 text-gray-400 select-none" title="Search for a destination first to enable sorting">
            <Search size={13} className="shrink-0" />
            <span className="text-[11.5px] font-medium">Search to sort & filter results</span>
          </div>
        )}
      </div>

      <div className="px-4 py-2 border-b border-gray-200 shrink-0 bg-gray-50 flex items-center">
        {isLoading ? (
          <p className="text-[11px] text-gray-500 font-medium w-full text-center py-0.5">
            ⏳ Loading carparks…
          </p>
        ) : loadError ? (
          <p className="text-[11px] text-red-500 font-medium w-full py-0.5">{loadError}</p>
        ) : isSearchMode ? (
          <p className="text-[11.5px] text-gray-600 font-medium w-full truncate py-0.5">
            <span className="text-gray-900 font-bold">{displayedCarparks.length}</span>{' '}
            {isSearching ? 'loading…' : `results within ${searchRadius >= 1000 ? `${searchRadius / 1000}km` : `${searchRadius}m`}`}
            {freshnessText ? ` · ${freshnessText}` : ''}
          </p>
        ) : (
          <p className="text-[11.5px] text-gray-600 font-medium w-full truncate py-0.5">
            <span className="text-gray-900 font-bold">{displayedCarparks.length}</span>{' '}
            carparks · sorted A–Z
            {freshnessText ? ` · ${freshnessText}` : ''}
          </p>
        )}
      </div>

      <div className="panel-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#F9FAFB] p-4 space-y-3">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white border border-gray-100 rounded-xl h-20 animate-pulse shadow-sm" />
          ))
        ) : isSearching ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white border border-gray-100 rounded-xl h-20 animate-pulse shadow-sm" />
          ))
        ) : displayedCarparks.length === 0 ? (
          <div className="text-center pt-12">
            <Search className="mx-auto mb-3 text-gray-300" size={32} />
            <p className="text-[13px] font-bold text-gray-700">No carparks found</p>
            <p className="text-[11.5px] text-gray-500 mt-1">
              {isSearchMode
                ? 'Try expanding the radius or a different location'
                : 'No carpark data available'}
            </p>
          </div>
        ) : (
          displayedCarparks.map((cp) => (
            <CarparkCard
              key={cp.id}
              carpark={cp}
              isSelected={selectedCarpark === cp.id}
              showRainIcon={rainMode}
              hideDistance={!isSearchMode}
              onClick={() => onCardClick(cp)}
              onViewDetails={() => onViewDetails(cp.id)}
            />
          ))
        )}
      </div>

      <div className="px-4 py-2 border-t border-gray-200 shrink-0 bg-white flex justify-between items-center">
        <p className="text-[10px] font-medium text-gray-400">
          {allCarparksLength > 0 ? `${allCarparksLength} total carparks` : ''}
        </p>
        <p className="text-[10px] font-medium text-gray-400">Singapore</p>
      </div>
    </>
  )
})

// ─── Map Controller (programmatic fly-to) ─────────────────────────────────────
function MapController({
  flyTarget,
}: {
  flyTarget: { lat: number; lng: number; zoom: number; duration?: number } | null
}) {
  const map = useMap()

  useEffect(() => {
    if (flyTarget) {
      map.flyTo([flyTarget.lat, flyTarget.lng], flyTarget.zoom, {
        duration: flyTarget.duration ?? 1.2,
        animate: flyTarget.duration !== 0,
      })
    }
  }, [flyTarget, map])

  return null
}

// ─── Main Map Explorer Page ───────────────────────────────────────────────────
export function MapExplorerPage() {
  const navigate = useNavigate()

  // ── Data ──────────────────────────────────────────────────────────────────
  const [allCarparks, setAllCarparks] = useState<Carpark[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // ── Search state ──────────────────────────────────────────────────────────
  const [searchCoords, setSearchCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [searchLabel, setSearchLabel] = useState<string | null>(null)
  const [searchRadius, setSearchRadius] = useState(500)
  const [nearbyCarparks, setNearbyCarparks] = useState<Carpark[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const cancelRef = useRef(false)

  // ── Location ──────────────────────────────────────────────────────────────
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [locationLoading, setLocationLoading] = useState(false)

  // ── UI ────────────────────────────────────────────────────────────────────
  const [selectedCarpark, setSelectedCarpark] = useState<string | null>(null)
  // ID to scroll to after search is cleared (async: wait for list to re-render)
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'recommended' | 'cheapest' | 'closest' | 'available'>('recommended')
  const [rainMode, setRainMode] = useState(false)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false)
  const [lastFetchAt, setLastFetchAt] = useState<Date | null>(null)

  // ── Map control ───────────────────────────────────────────────────────────
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number; zoom: number; duration?: number } | null>(null)
  const mapRef = useRef<L.Map>(null)

  const isSearchMode = searchCoords !== null
  const recenterTarget = useMemo(
    () => {
      if (userLocation) return { ...userLocation, zoom: SEARCH_ZOOM }
      if (searchCoords) return { ...searchCoords, zoom: SEARCH_ZOOM }
      return { lat: SG_CENTER[0], lng: SG_CENTER[1], zoom: SG_ZOOM }
    },
    [searchCoords, userLocation],
  )
  const recenterLabel = userLocation
    ? 'Recenter on my location'
    : searchCoords
      ? 'Recenter on search location'
      : 'Recenter Singapore map'

  const handleRecenter = useCallback(() => {
    mapRef.current?.flyTo(
      [recenterTarget.lat, recenterTarget.lng],
      recenterTarget.zoom,
      { duration: 0.8 },
    )
  }, [recenterTarget])

  // ── Load all carparks once ─────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const raw = await getAllCarparks()
        setAllCarparks(raw.map(transformCarpark))
        setLastFetchAt(new Date())
      } catch {
        setLoadError('Failed to load carpark data. Please refresh.')
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  // ── Displayed list ─────────────────────────────────────────────────────────
  // SEARCH MODE  → nearbyCarparks from /nearby (accurate server-side distances)
  // BROWSE MODE  → all carparks sorted A–Z (no reference point needed)
  const displayedCarparks = useMemo(() => {
    if (isSearchMode) {
      let list = [...nearbyCarparks]
      if (rainMode) list = filterShelteredCarparks(list)
      return sortCarparks(list, sortBy)
    }
    let list = [...allCarparks]
    if (rainMode) list = filterShelteredCarparks(list)
    // Default: alphabetical — no misleading distance from SG center
    return list.sort((a, b) => a.name.localeCompare(b.name))
  }, [allCarparks, nearbyCarparks, isSearchMode, rainMode, sortBy])

  // ── Scroll to pending card after search is cleared ─────────────────────────
  useEffect(() => {
    if (!pendingScrollId || isSearchMode) return
    // List has re-rendered with all carparks; now scroll to the card
    const id = pendingScrollId
    setPendingScrollId(null)
    setSelectedCarpark(id)
    requestAnimationFrame(() => {
      document.getElementById(`carpark-${id}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    })
  }, [pendingScrollId, isSearchMode])

  // ── Fetch /nearby ──────────────────────────────────────────────────────────
  const fetchNearby = useCallback(
    async (coords: { lat: number; lng: number }, radius: number) => {
      cancelRef.current = false
      setIsSearching(true)
      setSearchError(null)
      try {
        const raw = await getNearbyCarparks(coords.lat, coords.lng, radius)
        if (cancelRef.current) return
        setNearbyCarparks(raw.map(transformCarpark))
        setLastFetchAt(new Date())
      } catch {
        if (!cancelRef.current) setSearchError('Failed to fetch nearby carparks.')
      } finally {
        if (!cancelRef.current) setIsSearching(false)
      }
    },
    [],
  )

  // ── Re-fetch when radius changes (only if already in search mode) ──────────
  useEffect(() => {
    if (searchCoords) {
      fetchNearby(searchCoords, searchRadius)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchRadius])

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleSearch = useCallback(
    async (query: string) => {
      cancelRef.current = false
      setIsSearching(true)
      setSearchError(null)
      try {
        const coords = await geocodeQuery(query)
        if (cancelRef.current) return
        if (coords) {
          setSearchCoords(coords)
          setSearchLabel(query)
          setSelectedCarpark(null)
          setFlyTarget({ lat: coords.lat, lng: coords.lng, zoom: SEARCH_ZOOM, duration: 1.2 })
          await fetchNearby(coords, searchRadius)
          setMobilePanelOpen(false)
        } else {
          setSearchError('Location not found in Singapore.')
        }
      } catch {
        if (!cancelRef.current) setSearchError('Search failed. Please try again.')
      } finally {
        if (!cancelRef.current) setIsSearching(false)
      }
    },
    [fetchNearby, searchRadius],
  )

  const handleUseLocation = useCallback(async () => {
    setLocationLoading(true)
    setSearchError(null)
    cancelRef.current = false
    try {
      const coords = await getUserLocation()
      if (cancelRef.current) return
      setUserLocation(coords)
      setSearchCoords(coords)
      setSearchLabel('Your Location')
      setSelectedCarpark(null)
      setFlyTarget({ lat: coords.lat, lng: coords.lng, zoom: SEARCH_ZOOM, duration: 1.2 })
      await fetchNearby(coords, searchRadius)
      setMobilePanelOpen(false)
    } catch (err) {
      if (!cancelRef.current)
        setSearchError(
          err instanceof GeolocationError ? err.message : 'Could not retrieve your location.',
        )
    } finally {
      if (!cancelRef.current) setLocationLoading(false)
    }
  }, [fetchNearby, searchRadius])

  const handleClearSearch = useCallback(() => {
    cancelRef.current = true
    setSearchCoords(null)
    setSearchLabel(null)
    setNearbyCarparks([])
    setSelectedCarpark(null)
    setSearchError(null)
  }, [])

  // Clicking a card → fly map to that carpark and highlight its pin
  const handleCardClick = useCallback((cp: Carpark) => {
    setSelectedCarpark(cp.id)
    setMobilePanelOpen(false)
    // duration:0 = instant setView, so the marker is already in viewport when
    // CarparkPin's 120ms popup timer fires.
    setFlyTarget({ lat: cp.lat, lng: cp.lng, zoom: CARPARK_ZOOM, duration: 0 })
  }, [])

  // Clicking a map pin:
  //   • If it's in the current panel list → highlight + scroll to card
  //   • If it's NOT in the list (user searched somewhere else) → clear search,
  //     switch to browse mode, then scroll to the card in the full list
  const handleMarkerClick = useCallback(
    (id: string) => {
      setSelectedCarpark(id)
      const isInList = displayedCarparks.some((cp) => cp.id === id)
      if (!isInList && isSearchMode) {
        // Clear search first; the pendingScrollId effect will scroll once
        // the full list has rendered.
        cancelRef.current = true
        setSearchCoords(null)
        setSearchLabel(null)
        setNearbyCarparks([])
        setSearchError(null)
        setPendingScrollId(id)
      } else {
        // Already in the list — scroll immediately
        requestAnimationFrame(() => {
          document.getElementById(`carpark-${id}`)?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          })
        })
      }
    },
    [displayedCarparks, isSearchMode],
  )

  const handleViewDetails = useCallback(
    (id: string) => {
      const url = searchCoords
        ? `/carpark/${id}?lat=${searchCoords.lat}&lng=${searchCoords.lng}`
        : `/carpark/${id}`
      navigate(url)
    },
    [navigate, searchCoords],
  )

  const panelCarparks = isSearchMode ? displayedCarparks : allCarparks
  const latestAvailabilityTimestamp = useMemo(() => {
    const timestamps = panelCarparks
      .map((cp) => cp.availabilityUpdatedAt)
      .filter((ts): ts is string => typeof ts === 'string' && ts.length > 0)
      .map((ts) => new Date(ts))
      .filter((d) => Number.isFinite(d.getTime()))

    if (timestamps.length === 0) return null
    return new Date(Math.max(...timestamps.map((d) => d.getTime())))
  }, [panelCarparks])
  const freshnessText = useMemo(() => {
    if (latestAvailabilityTimestamp) {
      return formatLastUpdated(latestAvailabilityTimestamp)
    }
    if (lastFetchAt) {
      return `${formatLastUpdated(lastFetchAt)} (app fetch time)`
    }
    return null
  }, [latestAvailabilityTimestamp, lastFetchAt])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        .custom-popup .leaflet-popup-content-wrapper {
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15);
          padding: 8px 12px;
        }
        .custom-popup .leaflet-popup-content { margin: 0; }
        .custom-popup .leaflet-popup-close-button { color: #94a3b8 !important; top: 8px !important; right: 8px !important; }
        .panel-scroll::-webkit-scrollbar { width: 6px; }
        .panel-scroll::-webkit-scrollbar-track { background: transparent; }
        .panel-scroll::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 6px; }
        .panel-scroll::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
      `}</style>

      <div className="flex h-screen bg-white font-sans overflow-hidden text-gray-900">

        {/* ── LEFT PANEL ──────────────────────────────────────────────────── */}
        <div
          className="hidden md:flex md:flex-col bg-white border-r border-gray-200 transition-all duration-300 relative z-10"
          style={{ width: panelCollapsed ? 0 : 360, minWidth: panelCollapsed ? 0 : 360, overflow: 'hidden' }}
        >
          <ExplorerPanelContent
            showBackButton
            isDrawer={false}
            onBack={() => navigate('/')}
            isSearching={isSearching}
            locationLoading={locationLoading}
            onSearch={handleSearch}
            onUseLocation={handleUseLocation}
            searchError={searchError}
            isSearchMode={isSearchMode}
            searchLabel={searchLabel}
            onClearSearch={handleClearSearch}
            searchRadius={searchRadius}
            onSearchRadiusChange={setSearchRadius}
            sortBy={sortBy}
            rainMode={rainMode}
            onSortChange={setSortBy}
            onRainModeToggle={() => setRainMode((r) => !r)}
            isLoading={isLoading}
            loadError={loadError}
            displayedCarparks={displayedCarparks}
            selectedCarpark={selectedCarpark}
            onCardClick={handleCardClick}
            onViewDetails={handleViewDetails}
            allCarparksLength={allCarparks.length}
            freshnessText={freshnessText}
          />
        </div>

        {/* ── MAP AREA ──────────────────────────────────────────────────────── */}
        <div className="flex-1 relative overflow-hidden bg-gray-100 z-0">
          {/* Mobile back button */}
          <button
            onClick={() => navigate('/')}
            className="md:hidden absolute top-4 left-4 z-[1000] bg-white border border-gray-200 rounded-lg p-2 text-gray-600 shadow-md hover:bg-gray-50 transition-colors"
            title="Back to Home"
          >
            <ArrowLeft size={16} />
          </button>

          {/* Mobile drawer trigger */}
          <button
            type="button"
            onClick={() => setMobilePanelOpen(true)}
            className="md:hidden absolute top-4 right-4 z-[1000] bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-gray-700 shadow-md hover:bg-gray-50 transition-colors flex items-center gap-1.5"
            aria-label="Open carpark list and search"
          >
            <List size={14} className="text-blue-600" />
            <span className="text-[12px] font-bold">
              {isSearchMode ? `${displayedCarparks.length} results` : 'Browse carparks'}
            </span>
          </button>

          {/* Panel toggle */}
          <button
            onClick={() => setPanelCollapsed((c) => !c)}
            className="hidden md:flex absolute top-4 left-4 z-[1000] bg-white border border-gray-200 rounded-lg p-2 text-gray-600 shadow-md hover:bg-gray-50 transition-colors items-center gap-1.5"
          >
            <Layers size={16} className="text-blue-600" />
            {panelCollapsed && <span className="text-[12px] font-bold text-gray-700">Show panel</span>}
          </button>

          {/* Initial loading overlay */}
          {isLoading && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] flex flex-col items-center justify-center z-[2000]">
              <div className="w-10 h-10 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-3" />
              <p className="text-gray-900 font-bold text-sm">Loading Singapore Carparks…</p>
            </div>
          )}

          <MapContainer
            center={SG_CENTER}
            zoom={SG_ZOOM}
            style={{ height: '100%', width: '100%' }}
            zoomControl={false}
            ref={mapRef}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapController flyTarget={flyTarget} />

            {/* User location marker */}
            {userLocation && (
              <Marker
                position={[userLocation.lat, userLocation.lng]}
                icon={createUserLocationIcon()}
              >
                <Popup className="carpark-popup custom-popup">
                  <p className="text-blue-600 font-bold text-xs whitespace-nowrap m-0 px-1 py-0.5">
                    📍 Your Location
                  </p>
                </Popup>
              </Marker>
            )}

            {/* All carpark pins (always rendered — map is fully populated) */}
            {!isLoading && (
              <MarkerClusterGroup
                maxClusterRadius={50}
                showCoverageOnHover={false}
                spiderfyOnMaxZoom
                disableClusteringAtZoom={17}
              >
                {allCarparks.map((cp) => (
                  <CarparkPin
                    key={cp.id}
                    carpark={cp}
                    isSelected={selectedCarpark === cp.id}
                    onPinClick={handleMarkerClick}
                  />
                ))}
              </MarkerClusterGroup>
            )}
          </MapContainer>

          {/* Mobile peek bar keeps the list discoverable without covering the map. */}
          <div className="md:hidden absolute bottom-3 left-3 right-[4.5rem] z-[1000]">
            <button
              type="button"
              onClick={() => setMobilePanelOpen(true)}
              className="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white/95 px-3.5 py-2.5 text-left shadow-lg backdrop-blur-sm transition-colors hover:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              aria-label="Browse carpark list"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <List size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-bold text-gray-900">
                  {selectedCarpark
                    ? allCarparks.find((cp) => cp.id === selectedCarpark)?.name ?? 'Selected carpark'
                    : isSearchMode
                      ? `${displayedCarparks.length} carparks nearby`
                      : `${displayedCarparks.length} carparks across Singapore`}
                </span>
                <span className="block text-[10px] font-medium text-gray-500">
                  {selectedCarpark ? 'View details or browse the list' : 'Tap to search, sort, and filter'}
                </span>
              </span>
              <ChevronUp size={17} className="shrink-0 text-gray-400" />
            </button>
          </div>

          {/* Recenter after panning or zooming away from the active location. */}
          <button
            type="button"
            onClick={handleRecenter}
            className="absolute bottom-[76px] right-3 z-[1000] flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 shadow-lg transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/30 md:bottom-5 md:right-[4.5rem]"
            aria-label={recenterLabel}
            title={recenterLabel}
          >
            <LocateFixed size={19} className="text-blue-600" />
          </button>

          {/* Zoom controls */}
          <div className="absolute bottom-[20px] right-3 md:right-4 z-[1000] flex flex-col shadow-md rounded-xl overflow-hidden bg-white border border-gray-200">
            {[
              { label: '+', action: () => mapRef.current?.zoomIn() },
              { label: '−', action: () => mapRef.current?.zoomOut() },
            ].map(({ label, action }, i) => (
              <button
                key={label}
                onClick={action}
                className={`w-[36px] h-[36px] bg-white hover:bg-gray-50 text-gray-700 text-lg font-medium flex items-center justify-center transition-colors ${i === 0 ? 'border-b border-gray-100' : ''}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Legend */}
          <div className="hidden md:block absolute top-4 right-4 z-[1000] bg-white border border-gray-200 rounded-xl p-3 shadow-md">
            <p className="text-[10px] font-bold text-gray-500 mb-2 uppercase tracking-wide">Availability</p>
            {[
              { color: '#10B981', label: 'High Availability' },
              { color: '#F59E0B', label: 'Moderate / Low' },
              { color: '#EF4444', label: 'Full' },
              { color: '#9CA3AF', label: 'Not tracked' },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-2 mb-1.5 last:mb-0">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-[11px] font-medium text-gray-600">{label}</span>
              </div>
            ))}
          </div>
        </div>

        <Drawer open={mobilePanelOpen} onOpenChange={setMobilePanelOpen}>
          <DrawerContent className="md:hidden h-[82vh] max-h-[82vh] overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <ExplorerPanelContent
                showBackButton={false}
                isDrawer
                onBack={() => navigate('/')}
                isSearching={isSearching}
                locationLoading={locationLoading}
                onSearch={handleSearch}
                onUseLocation={handleUseLocation}
                searchError={searchError}
                isSearchMode={isSearchMode}
                searchLabel={searchLabel}
                onClearSearch={handleClearSearch}
                searchRadius={searchRadius}
                onSearchRadiusChange={setSearchRadius}
                sortBy={sortBy}
                rainMode={rainMode}
                onSortChange={setSortBy}
                onRainModeToggle={() => setRainMode((r) => !r)}
                isLoading={isLoading}
                loadError={loadError}
                displayedCarparks={displayedCarparks}
                selectedCarpark={selectedCarpark}
                onCardClick={handleCardClick}
                onViewDetails={handleViewDetails}
                allCarparksLength={allCarparks.length}
                freshnessText={freshnessText}
              />
            </div>
          </DrawerContent>
        </Drawer>
      </div>
    </>
  )
}
