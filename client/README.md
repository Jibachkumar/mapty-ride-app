├── assets/
├── scripts/
├── src/
│ ├── app/ # Expo Router routes ONLY — every file is route
│ │ ├── api/ # Server API routes grouped together
│ │ │ ├── user+api.ts # Endpoint -> /api/user
│ │ │ └── settings+api.ts # Endpoint -> /api/settings
│ │ ├── \_layout.tsx # Global app layout
│ │ ├── \_layout.web.tsx # Platform-specific web layout
│ │ ├── index.tsx # Root route -> /
│ │ └── settings.tsx # Settings route -> /settings
│ │
│ ├── components/ # Reusable UI components (button, card table)
│ │ ├── table/ # Complex component with private sub-components
│ │ │ ├── cell.tsx
│ │ │ └── index.tsx
│ │ ├── bar-chart.tsx # Default component
│ │ ├── bar-chart.web.tsx # Web-specific variant
│ │ └── button.tsx # Single UI component
│ │
│ ├── screens/ # Heavy screen bodies rendered by app/ routes
│ │ ├── home/
│ │ │ ├── card.tsx # Private component used ONLY by Home screen
│ │ │ └── index.tsx # Rendered by src/app/index.tsx
│ │ └── settings.tsx
│ │
│ ├── server/ # Server-only helpers used by app/api routes
│ │ ├── auth.ts # Database or auth logic
│ │ └── db.ts
│ │
│ ├── utils/ # Standalone utility functions + colocated tests
│ │ ├── format-date.ts
│ │ └── format-date.test.ts
│ │
│ ├── hooks/ # Custom reusable hooks (e.g., use-theme.ts)
│ ├── constants.ts # Global constants
│ └── theme.ts # App styling/theme definitions
│
├── app.json # Expo project configuration
├── eas.json # EAS Build/Submit configuration
└── package.json
