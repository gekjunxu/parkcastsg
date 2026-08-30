import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ArrowLeft, Filter, X } from 'lucide-react'
import { CarparkCard } from '../components/carpark-card'
import { CarparkMap } from '../components/carpark-map'
import { FilterChips } from '../components/filter-chips'
import { WeatherBanner } from '../components/weather-banner'
import { LoadingSkeleton } from '../components/loading-skeleton'
import {
  sortCarparks,
  filterShelteredCarparks,
  type Carpark,
} from '../data/carparks'
import { geocodeQuery } from '../../api/geocode'
import { getNearbyCarparks, transformCarpark } from '../../api/carparkService'
import { getWeatherForecast, type WeatherData } from '../../api/weatherService'

export function ResultsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [allCarparks, setAllCarparks] = useState<Carpark[]>([])
  const [carparks, setCarparks] = useState<Carpark[]>([])
  const [selectedCarpark, setSelectedCarpark] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<
    'recommended' | 'cheapest' | 'closest' | 'available'
  >('recommended')
  const [rainMode, setRainMode] = useState(false)
  const [showWeatherBanner, setShowWeatherBanner] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [searchCoords, setSearchCoords] = useState<{
    lat: number
    lng: number
  } | null>(null)
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [isWeatherAutoActivated, setIsWeatherAutoActivated] = useState(false)

  const destination = searchParams.get('q') || 'My Location'
  const latParam = searchParams.get('lat')
  const lngParam = searchParams.get('lng')
  const accuracyParam = searchParams.get('accuracy')
  const parsedLat = latParam !== null ? parseFloat(latParam) : NaN
  const parsedLng = lngParam !== null ? parseFloat(lngParam) : NaN
  const coordsFromParams =
    Number.isFinite(parsedLat) && Number.isFinite(parsedLng)
      ? { lat: parsedLat, lng: parsedLng }
      : null
  const parsedAccuracy =
    accuracyParam !== null ? parseFloat(accuracyParam) : NaN
  const userAccuracy =
    Number.isFinite(parsedAccuracy) && parsedAccuracy > 0
      ? parsedAccuracy
      : null

  const radiusParam = searchParams.get('radius')
  let radius = parseInt(radiusParam ?? '', 10)
  if (!Number.isFinite(radius) || radius <= 0) {
    radius = 500
  }

  // Track in-flight request so we can cancel stale results on fast navigation
  const cancelRef = useRef(false)

  const fetchCarparks = async () => {
    cancelRef.current = false
    setIsLoading(true)
    setError(null)

    try {
      // 1. Use explicit lat/lng from the URL when available; otherwise geocode the destination query.
      let coords = coordsFromParams

      if (!coords) {
        coords = await geocodeQuery(destination)
        if (cancelRef.current) return

        if (!coords) {
          setError(
            `Could not find location "${destination}". Try a different address or postal code.`,
          )
          setIsLoading(false)
          return
        }
      }

      setSearchCoords(coords)

      // 2. Fetch nearby carparks from the backend
      const raw = await getNearbyCarparks(coords.lat, coords.lng, radius)
      if (cancelRef.current) return

      // 3. Transform backend shape → frontend Carpark type
      let results: Carpark[] = raw.map(transformCarpark)

      // Fetch weather
      let isRainingLocally = false
      try {
        const weatherData = await getWeatherForecast(coords.lat, coords.lng)
        if (!cancelRef.current) {
          setWeather(weatherData)
          setShowWeatherBanner(true)
          if (weatherData.isRaining) {
            isRainingLocally = true
            setRainMode(true)
            setIsWeatherAutoActivated(true)
          } else {
            setIsWeatherAutoActivated(false)
          }
        }
      } catch (err) {
        console.error('Weather fetch error:', err)
      }

      if (cancelRef.current) return

      // Keep a copy of the full results
      setAllCarparks(results)

      // 4. Apply local filters
      if (rainMode || isRainingLocally) {
        results = filterShelteredCarparks(results)
      }
      results = sortCarparks(results, sortBy)

      setCarparks(results)
      setLastUpdated(new Date())
    } catch (err) {
      if (!cancelRef.current) {
        setError(
          'Failed to load carparks. Please check your connection and try again.',
        )
        console.error('Carpark fetch error:', err)
      }
    } finally {
      if (!cancelRef.current) {
        setIsLoading(false)
      }
    }
  }

  useEffect(() => {
    fetchCarparks()
    return () => {
      // Cancel stale requests on destination / radius change
      cancelRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination, latParam, lngParam, radius])

  // Re-apply filters/sort without re-fetching from the network
  useEffect(() => {
    let results = [...allCarparks]
    if (rainMode) {
      results = filterShelteredCarparks(results)
    }
    setCarparks(sortCarparks(results, sortBy))
  }, [allCarparks, sortBy, rainMode])

  const handleCarparkClick = (id: string) => {
    setSelectedCarpark(id)
    const element = document.getElementById(`carpark-${id}`)
    element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  const handleViewDetails = (id: string) => {
    let url = `/carpark/${id}`
    if (searchCoords) {
      url += `?lat=${searchCoords.lat}&lng=${searchCoords.lng}`
    }
    navigate(url)
  }

  const handleMapPinClick = (id: string) => {
    setSelectedCarpark(id)
    const element = document.getElementById(`carpark-${id}`)
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const formatLastUpdated = (date: Date): string => {
    const secs = Math.round((Date.now() - date.getTime()) / 1000)
    if (secs < 60) return 'Just now'
    const mins = Math.round(secs / 60)
    return `${mins} min${mins !== 1 ? 's' : ''} ago`
  }

  // Build a results URL preserving the current search type (coords vs text)
  const buildResultsUrl = (newRadius: number): string => {
    if (coordsFromParams) {
      const accuracySegment =
        userAccuracy !== null ? `&accuracy=${Math.round(userAccuracy)}` : ''
      return `/results?lat=${coordsFromParams.lat}&lng=${coordsFromParams.lng}${accuracySegment}&radius=${newRadius}`
    }
    return `/results?q=${encodeURIComponent(destination)}&radius=${newRadius}`
  }

  return (
    <div className='h-screen flex flex-col bg-[#F9FAFB]'>
      {/* Sticky Header */}
      <div className='bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-20 shadow-sm'>
        <div className='flex items-center gap-3'>
          <button
            onClick={() => navigate('/')}
            className='p-2 hover:bg-gray-100 rounded-lg transition-colors'
          >
            <ArrowLeft className='w-5 h-5 text-gray-700' />
          </button>
          <div className='flex-1 min-w-0'>
            <h2 className='text-lg font-semibold text-gray-900 truncate'>
              {coordsFromParams ? 'My Location' : destination}
            </h2>
          </div>
          <button
            onClick={fetchCarparks}
            className='p-2 hover:bg-gray-100 rounded-lg transition-colors'
            title='Refresh'
          >
            <Filter className='w-5 h-5 text-gray-700' />
          </button>
        </div>

        {/* Radius Pills */}
        <div className='flex gap-2 mt-3'>
          {[300, 500, 1000, 2000].map((val) => {
            const label = val >= 1000 ? `${val / 1000}km` : `${val}m`
            return (
              <button
                key={val}
                onClick={() => navigate(buildResultsUrl(val))}
                className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                  radius === val
                    ? 'bg-[#1A56DB] text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Weather Alert */}
      {showWeatherBanner && weather && (
        <WeatherBanner
          weatherText={`${weather.forecast} expected in ${weather.area}`}
          isAutoActivated={isWeatherAutoActivated}
          isRaining={weather.isRaining}
          onDismiss={() => setShowWeatherBanner(false)}
        />
      )}

      {/* Filter Chips */}
      <div className='bg-white px-4 py-3 border-b border-gray-200 sticky top-[120px] z-10'>
        <FilterChips
          selectedFilter={sortBy}
          rainMode={rainMode}
          onFilterChange={setSortBy}
          onRainModeToggle={() => setRainMode(!rainMode)}
        />
      </div>

      {/* Main Content */}
      <div className='flex-1 flex flex-col lg:flex-row overflow-hidden'>
        {/* Carpark List */}
        <div className='lg:w-2/5 bg-white border-r border-gray-200 overflow-y-auto max-h-[40vh] lg:max-h-none'>
          <div className='p-4 space-y-3'>
            {isLoading ? (
              <LoadingSkeleton count={5} />
            ) : error ? (
              <div className='text-center py-12'>
                <div className='w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4'>
                  <X className='w-8 h-8 text-red-400' />
                </div>
                <h3 className='text-lg font-semibold text-gray-900 mb-2'>
                  Something went wrong
                </h3>
                <p className='text-gray-600 mb-4 text-sm'>{error}</p>
                <button
                  onClick={fetchCarparks}
                  className='text-[#1A56DB] font-medium hover:underline'
                >
                  Try again
                </button>
              </div>
            ) : carparks.length === 0 ? (
              <div className='text-center py-12'>
                <div className='w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4'>
                  <Filter className='w-8 h-8 text-gray-400' />
                </div>
                <h3 className='text-lg font-semibold text-gray-900 mb-2'>
                  No carparks found
                </h3>
                <p className='text-gray-500 text-sm mb-1'>
                  This area may have limited HDB carparks.
                </p>
                <p className='text-gray-500 text-sm mb-5'>
                  Try a wider search radius below.
                </p>
                <div className='flex flex-col gap-2 items-center'>
                  {radius < 2000 && (
                    <button
                      onClick={() => navigate(buildResultsUrl(2000))}
                      className='px-5 py-2.5 bg-[#1A56DB] text-white text-sm font-medium rounded-lg hover:bg-[#1444b8] transition-colors'
                    >
                      Expand to 2km
                    </button>
                  )}
                  {rainMode && (
                    <button
                      onClick={() => setRainMode(false)}
                      className='text-[#1A56DB] text-sm font-medium hover:underline'
                    >
                      Remove sheltered filter
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                {carparks.map((carpark) => (
                  <CarparkCard
                    key={carpark.id}
                    carpark={carpark}
                    isSelected={selectedCarpark === carpark.id}
                    showRainIcon={rainMode}
                    onClick={() => handleCarparkClick(carpark.id)}
                    onViewDetails={() => handleViewDetails(carpark.id)}
                  />
                ))}
              </>
            )}
          </div>

          {/* Last Updated Timestamp */}
          {!isLoading && !error && carparks.length > 0 && lastUpdated && (
            <div className='px-4 py-3 text-xs text-gray-500 border-t border-gray-100'>
              Live data · Last updated: {formatLastUpdated(lastUpdated)}
            </div>
          )}
        </div>

        {/* Map */}
        <div className='lg:w-3/5 h-64 lg:h-auto'>
          <CarparkMap
            carparks={carparks}
            selectedCarparkId={selectedCarpark}
            onPinClick={handleMapPinClick}
            userLocation={coordsFromParams}
            userAccuracy={userAccuracy ?? undefined}
            recenterLocation={searchCoords ?? coordsFromParams}
          />
        </div>
      </div>
    </div>
  )
}
