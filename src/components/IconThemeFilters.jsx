import React, { useMemo } from 'react';

const IconThemeFilters = ({ settings }) => {
    const enabled = settings?.iconTheming?.enabled;
    const mode = settings?.iconTheming?.mode || 'grayscale'; // 'grayscale' | 'color'
    const color = settings?.iconTheming?.color || '#00ffff';

    const matrix = useMemo(() => {
        if (!enabled) return null;

        if (mode === 'grayscale') {
            // Standard grayscale matrix
            return `
        0.2126 0.7152 0.0722 0 0
        0.2126 0.7152 0.0722 0 0
        0.2126 0.7152 0.0722 0 0
        0      0      0      1 0
      `;
        }

        if (mode === 'color') {
            // Convert hex color to RGB normalized (0-1)
            let r = 0, g = 0, b = 0;
            if (color.startsWith('#')) {
                const hex = color.slice(1);
                if (hex.length === 3) {
                    r = parseInt(hex[0] + hex[0], 16) / 255;
                    g = parseInt(hex[1] + hex[1], 16) / 255;
                    b = parseInt(hex[2] + hex[2], 16) / 255;
                } else if (hex.length === 6) {
                    r = parseInt(hex.slice(0, 2), 16) / 255;
                    g = parseInt(hex.slice(2, 4), 16) / 255;
                    b = parseInt(hex.slice(4, 6), 16) / 255;
                }
            }

            // Map luminance to target color
            // R_out = L * R_target
            // G_out = L * G_target
            // B_out = L * B_target
            return `
        ${0.2126 * r} ${0.7152 * r} ${0.0722 * r} 0 0
        ${0.2126 * g} ${0.7152 * g} ${0.0722 * g} 0 0
        ${0.2126 * b} ${0.7152 * b} ${0.0722 * b} 0 0
        0             0             0             1 0
      `;
        }

        return null;
    }, [enabled, mode, color]);

    if (!enabled) return null;

    return (
        <svg style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}>
            <defs>
                <filter id="icon-theme-filter" colorInterpolationFilters="sRGB">
                    <feColorMatrix type="matrix" values={matrix} />
                </filter>
            </defs>
        </svg>
    );
};

export default IconThemeFilters;
