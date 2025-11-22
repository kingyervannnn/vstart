# Vivaldi Hybrid Start Page

A custom start page for Vivaldi browser that combines the best features from Vivaldi's native start page and modern web technologies. This hybrid implementation features a three-column layout, authentic Vivaldi-style speed dial with drag-and-drop functionality, and an advanced search system with inline search capabilities.

## Features

### 🎯 Speed Dial
- **Authentic Vivaldi-style implementation** with proper favicon retrieval system
- **Drag-and-drop functionality** for rearranging tiles
- **Vertical orientation** optimized for the right column (2 columns layout)
- **Custom icon support** - upload your own icons for tiles
- **Background upload support** - full resolution GIFs and images
- **Background repository storage** - export backgrounds to add to the repo
- **Automatic favicon fetching** with multiple fallback sources
- **Add/remove tiles** with intuitive interface

### 🔍 Advanced Search System
- **Inline search mode** with SearXNG integration
- **AI mode** (placeholder for future implementation)
- **Search suggestions** with autocomplete and recent searches
- **Retro-styled search results** with cyberpunk aesthetics
- **Multiple search engines** support (Google, DuckDuckGo, Bing)
- **Keyboard navigation** for suggestions
- **Animated transitions** and smooth interactions

### 🎨 Three-Column Layout
- **Left column**: Clock and Weather widgets
- **Center column**: Main content area with search results
- **Right column**: Speed Dial with vertical orientation
- **Responsive design** that adapts to different screen sizes
- **Glass morphism effects** with customizable transparency

### 🌟 Visual Features
- **Cyberpunk theme** with neon effects and scan lines
- **Animated backgrounds** with support for GIFs
- **Matrix-style grid overlay** and neon glow effects
- **Smooth animations** using Framer Motion
- **Dark theme** optimized for low-light usage

## Quick Start

### Using Docker Compose (Recommended)

1. **Clone or extract the project**
2. **Navigate to the project directory**
3. **Start the application**:
   ```bash
   docker-compose up -d
   ```
4. **Access the start page** at `http://localhost:3000`

### Development Mode

1. **Install dependencies**:
   ```bash
   npm install
   # or
   pnpm install
   ```

2. **Start development server**:
   ```bash
   npm run dev
   # or
   pnpm run dev
   ```

3. **Open** `http://localhost:5173` in your browser

## Configuration

### Setting as Vivaldi Start Page

1. Open Vivaldi browser
2. Go to `Settings` > `Start Page`
3. Select "Custom Page"
4. Enter: `http://localhost:3000` (or your deployed URL)

### Search Engine Configuration

The search system supports multiple engines. You can modify the default engine in the settings or by editing the configuration in the source code.

### Background Customization

- Click the **image upload button** in the Speed Dial header
- Upload any image or GIF file
- The background will be applied immediately
- Supports full resolution for crisp display

## Architecture

### Frontend Stack
- **React 18** with modern hooks
- **Vite** for fast development and building
- **Tailwind CSS** for styling
- **Framer Motion** for animations
- **Lucide React** for icons

### Key Components
- `VivaldiSpeedDial` - Authentic speed dial implementation
- `SearchBox` - Advanced search with inline mode
- `ClockWidget` - Real-time clock display
- `WeatherWidget` - Weather information display

### Docker Setup
- **Multi-stage build** for optimized production images
- **Nginx** for serving static files
- **SearXNG** integration for search functionality
- **Redis** for caching search results

## Search Integration

### SearXNG Backend
The application includes optional SearXNG integration for privacy-focused search:

1. **Start with SearXNG**:
   ```bash
   docker-compose up -d
   ```

2. **SearXNG will be available** at `http://localhost:8080`

3. **Configure search endpoint** in the application settings

### Search Features
- **Inline search results** displayed without leaving the page
- **Search suggestions** with recent searches
- **Multiple result sources** aggregated through SearXNG
- **Privacy-focused** - no tracking or data collection

## Customization

### Themes and Colors
The application supports theme customization through CSS custom properties:

```css
:root {
  --color-primary: #ffffff;
  --color-secondary: #00ffff;
  --color-accent: #ff00ff;
  --transparency-global: 0.1;
  --glass-blur: 16px;
}
```

### Speed Dial Layout
Modify the speed dial layout by changing the `COLS` constant in `VivaldiSpeedDial.jsx`:

```javascript
const COLS = 2 // Change to 3 or 4 for different layouts
```

### Search Engines
Add new search engines in the `getSearchUrl` function:

```javascript
case 'your-engine':
  return `https://your-search-engine.com/search?q=${encodedQuery}`
```

## Browser Compatibility

- **Vivaldi** (primary target)
- **Chrome/Chromium** 
- **Firefox**
- **Safari** (limited testing)
- **Edge**

## Performance

- **Optimized bundle size** with tree shaking
- **Lazy loading** for components
- **Efficient favicon caching**
- **Minimal re-renders** with React optimization
- **Fast startup time** with Vite

## Security

- **Content Security Policy** headers
- **XSS protection** enabled
- **No external tracking** scripts
- **Local storage** for user preferences only

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Background Management

### Uploading Backgrounds
- Use the Background Manager in Settings to upload custom backgrounds
- Supported formats: JPG, PNG, GIF, WebP
- Large files are supported (up to 250MB)
- Custom backgrounds are stored in IndexedDB (browser storage)

### Built-in Backgrounds
All built-in backgrounds are stored in `src/assets/` and bundled with the application:
- Default backgrounds are available immediately on first install
- Backgrounds include static images and animated GIFs
- To add new backgrounds to the repository:
  1. Place image/GIF files in `src/assets/` directory
  2. Import them in `src/components/BackgroundManager.jsx`
  3. Add them to the `BUILTIN_BACKGROUNDS` array

## License

This project is open source and available under the MIT License.

## Acknowledgments

- **Vivaldi Browser** for inspiration and design patterns
- **SearXNG** for privacy-focused search capabilities
- **React community** for excellent tooling and libraries

## Voice (Local STT/TTS)

This project includes an optional local voice proxy that keeps audio data on your machine.

- UI adds a microphone in the search box (normal and AI modes).
- Single‑press: turns input into a recorder with a waveform; press again to stop.
- On stop, the frontend POSTs the audio blob to `/api/transcribe` (Node proxy on port 3099).
- The proxy will:
  1) call `~/Desktop/sys/xtts/xtts ensure` to auto‑start the XTTS server if needed,
  2) run local STT (Whisper/whisper.cpp if installed) to transcribe,
  3) optionally call the AI router and include a non‑streamed reply.
- A temporary “send” arrow appears to submit the transcript (search or AI).
- TTS is proxied at `/api/tts` and forwards to XTTS on `127.0.0.1:8088`.

Docker compose includes a `voice-api` service on `:3099`. If running in Docker, set `XTTS_URL=http://host.docker.internal:8088` so the container can reach your local XTTS server. The proxy has a 10‑minute idle timer that stops XTTS automatically.


## Support

For issues, questions, or feature requests, please create an issue in the project repository.

---

**Note**: This is a custom implementation inspired by Vivaldi's start page design. It is not officially affiliated with Vivaldi Technologies.
