import { useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { suggestLocations, type LocationSuggestion } from '../../api/geocode'
import { Input, type InputAppearance } from './ui/input'
import '../../styles/destination-search.css'

const DEBOUNCE_MS = 250

export type DestinationSearchVariant = 'embedded' | 'standalone'

const inputAppearanceByVariant: Record<DestinationSearchVariant, InputAppearance> = {
  embedded: 'bare',
  standalone: 'default',
}

export interface DestinationSearchProps {
  value: string
  onChange: (value: string) => void
  onSelect: (suggestion: LocationSuggestion) => void
  onSubmit: () => void
  inputLabel: string
  placeholder: string
  className?: string
  variant?: DestinationSearchVariant
}

export function DestinationSearch({
  value,
  onChange,
  onSelect,
  onSubmit,
  inputLabel,
  placeholder,
  className = '',
  variant = 'embedded',
}: DestinationSearchProps) {
  const listId = useId()
  const [focused, setFocused] = useState(false)
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const controller = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const composing = useRef(false)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function cancelPending() {
    generation.current += 1
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    controller.current?.abort()
    controller.current = null
  }

  function closeSuggestions() {
    cancelPending()
    setSuggestions([])
    setActiveIndex(-1)
  }

  function clearSearch() {
    onChange('')
    closeSuggestions()
    inputRef.current?.focus()
  }

  function selectSuggestion(suggestion: LocationSuggestion) {
    onChange(suggestion.label)
    onSelect(suggestion)
    setFocused(false)
    closeSuggestions()
  }

  useEffect(() => {
    const query = value.trim()
    cancelPending()
    setSuggestions([])
    setActiveIndex(-1)

    if (!focused || query.length < 2 || query.length > 100) return

    const requestGeneration = generation.current
    timer.current = setTimeout(async () => {
      const nextController = new AbortController()
      controller.current = nextController
      try {
        const next = await suggestLocations(query, nextController.signal)
        if (requestGeneration !== generation.current || nextController.signal.aborted) return
        setSuggestions(next)
      } catch (error) {
        if (requestGeneration !== generation.current || nextController.signal.aborted) return
        if (!(error instanceof DOMException && error.name === 'AbortError')) setSuggestions([])
      } finally {
        if (requestGeneration === generation.current) controller.current = null
      }
    }, DEBOUNCE_MS)

    return cancelPending
  }, [focused, value])

  useEffect(() => () => {
    cancelPending()
    if (blurTimer.current) clearTimeout(blurTimer.current)
  }, [])

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || composing.current) return
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault()
      setActiveIndex(index => (index + 1) % suggestions.length)
      return
    }
    if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault()
      setActiveIndex(index => (index <= 0 ? suggestions.length - 1 : index - 1))
      return
    }
    if (event.key === 'Escape') {
      if (suggestions.length || focused) event.preventDefault()
      closeSuggestions()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const active = suggestions[activeIndex]
      if (active) selectSuggestion(active)
      else onSubmit()
    }
  }

  return (
    <div className="destination-search">
      <Input
        ref={inputRef}
        appearance={inputAppearanceByVariant[variant]}
        className={['destination-search-input', \`destination-search-input--\${variant}\`, className, value ? 'destination-search-input-with-clear' : ''].filter(Boolean).join(' ')}
        type="text"
        role="combobox"
        aria-label={inputLabel}
        aria-autocomplete="list"
        aria-expanded={suggestions.length > 0}
        aria-controls={listId}
        aria-activedescendant={activeIndex >= 0 ? \`\${listId}-option-\${activeIndex}\` : undefined}
        placeholder={placeholder}
        value={value}
        onChange={event => onChange(event.target.value)}
        onFocus={() => {
          if (blurTimer.current) clearTimeout(blurTimer.current)
          setFocused(true)
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(() => {
            setFocused(false)
            closeSuggestions()
          }, 0)
        }}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => { composing.current = true }}
        onCompositionEnd={() => { composing.current = false }}
        enterKeyHint="search"
      />
      {value && <button
        type="button"
        className="destination-search-clear"
        aria-label="Clear search"
        onMouseDown={event => event.preventDefault()}
        onClick={clearSearch}
      ><X size={16} aria-hidden="true" /></button>}
      {suggestions.length > 0 && (
        <ul id={listId} className="destination-search-list" role="listbox">
          {suggestions.map((suggestion, index) => (
            <li
              id={\`\${listId}-option-\${index}\`}
              key={\`\${suggestion.label}-\${suggestion.lat}-\${suggestion.lng}\`}
              role="option"
              aria-selected={activeIndex === index}
              onMouseDown={event => {
                event.preventDefault()
                selectSuggestion(suggestion)
              }}
            >
              <strong>{suggestion.label}</strong>
              {suggestion.address && <span>{suggestion.address}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

