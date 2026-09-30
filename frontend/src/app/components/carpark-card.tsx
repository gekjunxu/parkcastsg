import { MapPin, CloudRain } from 'lucide-react';
import { type Carpark, getAvailabilityColor, getAvailabilityText, formatCarparkType } from '../data/carparks';
import { calculateLiveRates } from '../utils/pricingEngine';

interface CarparkCardProps {
    carpark: Carpark;
    isSelected: boolean;
    showRainIcon: boolean;
    onClick: () => void;
    onViewDetails?: () => void;
    hideDistance?: boolean;
}

export function CarparkCard({ carpark, isSelected, showRainIcon, onClick, onViewDetails, hideDistance }: CarparkCardProps) {
    const availabilityColor = getAvailabilityColor(carpark.availabilityLevel);
    const availabilityText = getAvailabilityText(carpark);
    const isLta = carpark.source === 'lta';
    const isSupplemental = carpark.source === 'supplemental';
    const isNonHdb = isLta || isSupplemental;

    return (
        <div
            id={`carpark-${carpark.id}`}
            onClick={onClick}
            className={`bg-white rounded-[12px] p-4 border-2 cursor-pointer transition-all ${isSelected
                ? 'border-[#1A56DB] shadow-md'
                : carpark.availabilityLevel === 'full'
                    ? 'border-gray-200 opacity-60'
                    : 'border-gray-200 hover:border-[#1A56DB] hover:shadow-md'
                }`}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-start gap-2 mb-2">
                        <h3 className="font-semibold text-gray-900 text-base flex-1 truncate">
                            <button type="button" className="text-left w-full" aria-label={`Show ${carpark.name} on map`}>{carpark.name}</button>
                        </h3>
                        {carpark.isRecommended && (
                            <span className="px-2 py-0.5 bg-[#10B981] text-white text-xs font-medium rounded-full whitespace-nowrap">
                                Recommended
                            </span>
                        )}
                        {isNonHdb && (
                            <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs font-medium rounded-full whitespace-nowrap">
                                Non-HDB
                            </span>
                        )}
                    </div>

                    {/* Address */}
                    <div className="flex items-center gap-1 text-sm text-gray-600 mb-3">
                        <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{carpark.address}</span>
                    </div>

                    {/* Info Row */}
                    <div className="flex items-center gap-4 flex-wrap">
                        {/* Availability */}
                        <div className="flex items-center gap-1.5">
                            <div
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: availabilityColor }}
                            />
                            <span className="text-sm font-medium text-gray-900">{availabilityText}</span>
                        </div>

                        {/* Walking Distance */}
                        {!hideDistance && (
                            <span className="text-sm text-gray-600 border-r border-gray-300 pr-4">{carpark.walkingMinutes} min walk</span>
                        )}

                        {/* Price */}
                        {isNonHdb ? (
                            <div className="flex items-center gap-1 text-sm font-medium text-gray-900">
                                <span>🚗</span>
                                <span>{calculateLiveRates(carpark).car}</span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-3 text-sm font-medium text-gray-900">
                                {(() => {
                                    const prices = calculateLiveRates(carpark);
                                    return (
                                        <>
                                            <div className="flex items-center gap-1" title="Motor Car">
                                                <span>🚗</span> {prices.car}
                                            </div>
                                            <div className="flex items-center gap-1" title="Motorcycle">
                                                <span>🏍️</span> {prices.motorcycle}
                                            </div>
                                            <div className="flex items-center gap-1" title="Heavy Vehicle">
                                                <span>🚚</span> {prices.heavy}
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>
                        )}

                        {/* Rain Icon */}
                        {showRainIcon && carpark.isSheltered && (
                            <div className="flex items-center gap-1 text-blue-600">
                                <CloudRain className="w-4 h-4" />
                            </div>
                        )}
                    </div>

                    {/* Recommendation Reason */}
                    {carpark.isRecommended && (
                        <div className="mt-2 pt-2 border-t border-gray-100">
                            <p className="text-xs text-gray-600">
                                High availability · {carpark.isSheltered ? 'Sheltered' : formatCarparkType(carpark.carparkType)}
                            </p>
                        </div>
                    )}
                    
                    {/* View Details Button (visible when selected) */}
                    {isSelected && (
                        <div className="mt-4 border-t border-gray-100 pt-3">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation(); // prevent triggering the card's onClick
                                    if (onViewDetails) onViewDetails();
                                }}
                                className="w-full min-h-11 bg-[#1A56DB] text-white py-2 rounded-lg text-sm font-medium hover:bg-[#1444b8] transition-colors"
                            >
                                View full details
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
