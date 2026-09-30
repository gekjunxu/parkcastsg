import { CloudRain } from 'lucide-react';

interface FilterChipsProps {
    selectedFilter: 'recommended' | 'cheapest' | 'closest' | 'available';
    rainMode: boolean;
    freeSundayParking: boolean;
    onFilterChange: (filter: 'recommended' | 'cheapest' | 'closest' | 'available') => void;
    onRainModeToggle: () => void;
    onFreeSundayParkingToggle: () => void;
}

export function FilterChips({
    selectedFilter,
    rainMode,
    freeSundayParking,
    onFilterChange,
    onRainModeToggle,
    onFreeSundayParkingToggle,
}: FilterChipsProps) {
    const filters: Array<{
        id: 'recommended' | 'cheapest' | 'closest' | 'available';
        label: string;
    }> = [
            { id: 'recommended', label: 'Recommended' },
            { id: 'cheapest', label: 'Cheapest' },
            { id: 'closest', label: 'Closest' },
            { id: 'available', label: 'Most Available' },
        ];

    return (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {filters.map((filter) => (
                <button
                    key={filter.id}
                    aria-pressed={selectedFilter === filter.id}
                    onClick={() => onFilterChange(filter.id)}
                    className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${selectedFilter === filter.id
                        ? 'bg-[#1A56DB] text-white shadow-md'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                >
                    {filter.label}
                </button>
            ))}

            {[
                { label: 'Rain Mode', active: rainMode, onToggle: onRainModeToggle, icon: <CloudRain className="w-4 h-4" /> },
                { label: 'Free Sunday/PH', active: freeSundayParking, onToggle: onFreeSundayParkingToggle, title: 'HDB carparks offering free parking on Sundays and public holidays during their stated hours' },
            ].map((filter) => (
                <button
                    key={filter.label}
                    aria-pressed={filter.active}
                    title={filter.title}
                    onClick={filter.onToggle}
                    className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all flex items-center gap-1.5 ${filter.active
                        ? 'bg-blue-500 text-white shadow-md'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                >
                    {filter.icon}
                    {filter.label}
                </button>
            ))}
        </div>
    );
}
