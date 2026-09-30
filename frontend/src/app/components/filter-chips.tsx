import { CloudRain } from 'lucide-react';

interface FilterChipsProps {
    selectedFilter: 'recommended' | 'cheapest' | 'closest' | 'available';
    rainMode: boolean;
    onFilterChange: (filter: 'recommended' | 'cheapest' | 'closest' | 'available') => void;
    onRainModeToggle: () => void;
}

export function FilterChips({
    selectedFilter,
    rainMode,
    onFilterChange,
    onRainModeToggle,
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

            <button
                aria-pressed={rainMode}
                onClick={onRainModeToggle}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all flex items-center gap-1.5 ${rainMode
                    ? 'bg-blue-500 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
            >
                <CloudRain className="w-4 h-4" />
                Rain Mode
            </button>
        </div>
    );
}
