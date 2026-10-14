import { useState } from 'react'
import { useNavigate } from 'react-router'
import { MapPin, Navigation, Map } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { getUserLocation, GeolocationError } from '../../api/geolocation'

export function HomePage() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [radius, setRadius] = useState<300 | 500 | 1000 | 2000>(1000)
  const [isLoggedIn] = useState(false) // Mock login state
  const showAuthButton = false
  const [locationLoading, setLocationLoading] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)

  const handleSearch = () => {
    if (searchQuery.trim()) {
      navigate(`/results?q=${encodeURIComponent(searchQuery)}&radius=${radius}`)
    }
  }

  const handleUseLocation = async () => {
    setLocationLoading(true)
    setLocationError(null)
    try {
      const coords = await getUserLocation()
      navigate(
        `/results?lat=${coords.lat}&lng=${coords.lng}&accuracy=${Math.round(coords.accuracy)}&radius=${radius}`,
      )
    } catch (err) {
      if (err instanceof GeolocationError) {
        setLocationError(err.message)
      } else {
        setLocationError('Could not retrieve your location. Please try again.')
      }
    } finally {
      setLocationLoading(false)
    }
  }

  const handleQuickAccess = (location: string) => {
    setSearchQuery(location)
    navigate(`/results?q=${encodeURIComponent(location)}&radius=${radius}`)
  }

  return (
    <div className='min-h-screen bg-[#F9FAFB]'>
      {/* Navigation Bar */}
      <nav className='bg-white border-b border-gray-200 px-4 py-3'>
        <div className='max-w-7xl mx-auto flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <img
              src={`${import.meta.env.BASE_URL}favicon.png`}
              alt='ParkCastSG Logo'
              className='w-8 h-8 rounded-lg object-contain'
            />
            <span className='text-xl font-semibold text-gray-900'>
              ParkCast SG
            </span>
          </div>
          {showAuthButton && (
            <Button
              variant='outline'
              className='border-[#1A56DB] text-[#1A56DB] hover:bg-[#1A56DB] hover:text-white'
            >
              Login / Sign Up
            </Button>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <div className='max-w-2xl mx-auto px-4 pt-16 pb-8'>
        <div className='text-center mb-12'>
          <h1 className='text-4xl md:text-5xl font-semibold text-gray-900 mb-4'>
            Find parking before you arrive
          </h1>
          <p className='text-lg text-gray-600'>
            Real-time availability, price comparison, and weather-aware
            recommendations
          </p>
        </div>

        {/* Search Section */}
        <div className='bg-white rounded-[12px] shadow-lg p-6 space-y-6'>
          {/* Search Bar */}
          <div className='relative'>
            <div className='absolute left-3 top-1/2 -translate-y-1/2 text-gray-400'>
              <MapPin className='w-5 h-5' />
            </div>
            <Input
              type='text'
              placeholder='Enter destination or postal code'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className='pl-10 pr-4 py-6 text-base border-gray-300 rounded-lg'
            />
          </div>

          {/* Use Location Button */}
          <div className='space-y-1'>
            <button
              onClick={handleUseLocation}
              disabled={locationLoading}
              className='flex items-center gap-2 text-[#1A56DB] hover:text-[#1444b8] transition-colors disabled:opacity-60 disabled:cursor-not-allowed'
            >
              <Navigation
                className={`w-4 h-4 ${locationLoading ? 'animate-pulse' : ''}`}
              />
              <span className='text-sm font-medium'>
                {locationLoading ? 'Getting location…' : 'Use my location'}
              </span>
            </button>
            {locationError && (
              <p className='text-xs text-red-600'>{locationError}</p>
            )}
          </div>

          {/* Radius Selector */}
          <div>
            <label className='block text-sm font-medium text-gray-700 mb-3'>
              Search radius
            </label>
            <div className='flex gap-2'>
              {[300, 500, 1000, 2000].map((r) => (
                <button
                  key={r}
                  onClick={() => setRadius(r as 300 | 500 | 1000 | 2000)}
                  className={`flex-1 py-2.5 px-4 rounded-full text-sm font-medium transition-all ${radius === r
                      ? 'bg-[#1A56DB] text-white shadow-md'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                >
                  {r >= 1000 ? `${r / 1000}km` : `${r}m`}
                </button>
              ))}
            </div>
          </div>

          {/* Search Button */}
          <div className='space-y-3'>
            <Button
              onClick={handleSearch}
              className='w-full py-6 bg-[#1A56DB] hover:bg-[#1444b8] text-white text-base rounded-lg'
            >
              Search Carparks
            </Button>
            <Button
              variant='outline'
              onClick={() => navigate('/map')}
              className='w-full py-6 text-[#1A56DB] border-gray-200 hover:border-[#1A56DB] hover:bg-blue-50 text-base rounded-lg flex items-center justify-center gap-2'
            >
              <Map className='w-5 h-5' />
              Explore All Carparks on Map
            </Button>
          </div>
        </div>

        {/* Quick Access (if logged in) */}
        {isLoggedIn && (
          <div className='mt-8'>
            <h3 className='text-sm font-medium text-gray-700 mb-3'>
              Quick access
            </h3>
            <div className='flex gap-3'>
              <button
                onClick={() => handleQuickAccess('Office, Raffles Place')}
                className='flex items-center gap-2 px-4 py-2.5 bg-white rounded-full border border-gray-200 hover:border-[#1A56DB] hover:bg-blue-50 transition-all'
              >
                <div className='w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center'>
                  <span className='text-xs'>🏢</span>
                </div>
                <span className='text-sm font-medium text-gray-700'>
                  Office
                </span>
              </button>
              <button
                onClick={() => handleQuickAccess('Home, Bishan')}
                className='flex items-center gap-2 px-4 py-2.5 bg-white rounded-full border border-gray-200 hover:border-[#1A56DB] hover:bg-blue-50 transition-all'
              >
                <div className='w-6 h-6 bg-green-100 rounded-full flex items-center justify-center'>
                  <span className='text-xs'>🏠</span>
                </div>
                <span className='text-sm font-medium text-gray-700'>Home</span>
              </button>
            </div>
          </div>
        )}

        {/* Background Map Illustration */}
        <div className='mt-12 opacity-20'>
          <svg
            viewBox='0 0 600 300'
            className='w-full h-auto'
            fill='none'
            xmlns='http://www.w3.org/2000/svg'
          >
            <path
              d='M100 150 L200 100 L300 180 L400 120 L500 160'
              stroke='#1A56DB'
              strokeWidth='2'
              strokeDasharray='5,5'
            />
            <circle cx='300' cy='180' r='8' fill='#10B981' />
            <circle cx='200' cy='100' r='6' fill='#F59E0B' />
            <circle cx='400' cy='120' r='6' fill='#10B981' />
          </svg>
        </div>
      </div>
    </div>
  )
}
