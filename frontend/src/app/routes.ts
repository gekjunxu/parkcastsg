import { createBrowserRouter } from 'react-router';
import { HomePage } from './pages/home-page';
import { ResultsPage } from './pages/results-page';
import { CarparkDetailPage } from './pages/carpark-detail-page';
import { MapExplorerPage } from './pages/map-explorer-page';

export const router = createBrowserRouter([
    {
        path: '/',
        Component: HomePage,
    },
    {
        path: '/results',
        Component: ResultsPage,
    },
    {
        path: '/map',
        Component: MapExplorerPage,
    },
    {
        path: '/carpark/:id',
        Component: CarparkDetailPage,
    },
], {
    basename: import.meta.env.BASE_URL === '/'
        ? undefined
        : import.meta.env.BASE_URL.replace(/\/$/, ''),
});
