import { CloudRain, Sun, Cloud, X } from 'lucide-react';

interface WeatherBannerProps {
    weatherText: string;
    isAutoActivated: boolean;
    isRaining: boolean;
    onDismiss: () => void;
}

export function WeatherBanner({ weatherText, isAutoActivated, isRaining, onDismiss }: WeatherBannerProps) {
    const isCloudy = !isRaining && weatherText.toLowerCase().includes('cloud');
    
    // Choose styles and icon based on weather type
    let bgColor = "bg-blue-50 border-blue-200";
    let textColor = "text-blue-900";
    let iconClass = "text-blue-600";
    let hoverColor = "hover:bg-blue-100";
    
    if (!isRaining) {
        if (isCloudy) {
            bgColor = "bg-gray-50 border-gray-200";
            textColor = "text-gray-900";
            iconClass = "text-gray-600";
            hoverColor = "hover:bg-gray-100";
        } else {
            bgColor = "bg-amber-50 border-amber-200";
            textColor = "text-amber-900";
            iconClass = "text-amber-600";
            hoverColor = "hover:bg-amber-100";
        }
    }

    const Icon = isRaining ? CloudRain : (isCloudy ? Cloud : Sun);

    return (
        <div className={`${bgColor} border-b px-4 py-3 relative z-10 shadow-sm transition-colors duration-300`}>
            <div className="flex items-center gap-3">
                <Icon className={`w-5 h-5 flex-shrink-0 ${iconClass}`} />
                <p className={`flex-1 text-sm leading-snug ${textColor}`}>
                    <span className="font-semibold">{weatherText}</span>
                    {isAutoActivated && " — Rain Mode auto-activated to hide confirmed unsheltered carparks."}
                </p>
                <button
                    onClick={onDismiss}
                    className={`p-1.5 rounded transition-colors flex-shrink-0 ${hoverColor}`}
                >
                    <X className={`w-4 h-4 ${iconClass}`} />
                </button>
            </div>
        </div>
    );
}
