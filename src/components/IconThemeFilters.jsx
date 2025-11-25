import React, { useMemo } from 'react';

const IconThemeFilters = ({ settings, activeWorkspaceId, anchoredWorkspaceId }) => {
    const enabled = settings?.iconTheming?.enabled;

    // Resolve effective settings
    const effectiveSettings = useMemo(() => {
        const globalSettings = {
            mode: settings?.iconTheming?.mode || 'grayscale',
            color: settings?.iconTheming?.color || '#00ffff',
            opacity: settings?.iconTheming?.opacity ?? 0.5,
        };

        if (!activeWorkspaceId || activeWorkspaceId === 'default' || activeWorkspaceId === anchoredWorkspaceId) {
            return globalSettings;
        }

        const workspaceSettings = settings?.iconTheming?.workspaces?.[activeWorkspaceId];
        if (!workspaceSettings) {
            return globalSettings;
        }

        // Check if workspace has overrides (if mode is not 'default' or undefined)
        if (workspaceSettings.mode && workspaceSettings.mode !== 'default') {
            return {
                mode: workspaceSettings.mode,
                color: workspaceSettings.color || globalSettings.color,
                opacity: workspaceSettings.opacity ?? globalSettings.opacity,
            };
        }

        return globalSettings;
    }, [settings?.iconTheming, activeWorkspaceId, anchoredWorkspaceId]);

    const { mode, color, opacity } = effectiveSettings;

    const matrix = useMemo(() => {
        if (!enabled) return null;

        // Common color parsing
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

        // Luminance coefficients
        const Lr = 0.2126;
        const Lg = 0.7152;
        const Lb = 0.0722;

        if (mode === 'grayscale') {
            // Standard grayscale matrix
            return `
        ${Lr} ${Lg} ${Lb} 0 0
        ${Lr} ${Lg} ${Lb} 0 0
        ${Lr} ${Lg} ${Lb} 0 0
        0      0      0      1 0
      `;
        }

        if (mode === 'monochrome') {
            // Previously "grayscale_and_tint" - Monochrome mapping
            // Map luminance to target color

            // Interpolate between Identity and Target based on opacity
            const a = opacity;
            const invA = 1 - a;

            return `
        ${invA + Lr * r * a} ${Lg * r * a} ${Lb * r * a} 0 0
        ${Lr * g * a} ${invA + Lg * g * a} ${Lb * g * a} 0 0
        ${Lr * b * a} ${Lg * b * a} ${invA + Lb * b * a} 0 0
        0 0 0 1 0
      `;
        }

        if (mode === 'grayscale_and_tint') {
            // New mode: Grayscale -> Tinted Monochrome
            // Interpolate between Grayscale Matrix and Monochrome Matrix

            // Grayscale Matrix (G):
            // Lr Lg Lb 0 0
            // Lr Lg Lb 0 0
            // Lr Lg Lb 0 0

            // Monochrome Matrix (M) (Target color at full intensity):
            // Lr*r Lg*r Lb*r 0 0
            // Lr*g Lg*g Lb*g 0 0
            // Lr*b Lg*b Lb*b 0 0

            // Result = G * (1 - a) + M * a

            const a = opacity;
            const invA = 1 - a;

            // Row 1 (Red output)
            // R_in coeff: Lr * invA + Lr * r * a = Lr * (invA + r * a)
            // G_in coeff: Lg * invA + Lg * r * a = Lg * (invA + r * a)
            // B_in coeff: Lb * invA + Lb * r * a = Lb * (invA + r * a)

            const R_mix = invA + r * a;
            const G_mix = invA + g * a;
            const B_mix = invA + b * a;

            return `
        ${Lr * R_mix} ${Lg * R_mix} ${Lb * R_mix} 0 0
        ${Lr * G_mix} ${Lg * G_mix} ${Lb * G_mix} 0 0
        ${Lr * B_mix} ${Lg * B_mix} ${Lb * B_mix} 0 0
        0 0 0 1 0
      `;
        }

        if (mode === 'tint') {
            // Multiply effect (Color Overlay)
            // R_out = R_in * (1 - a + R_tint * a)

            const a = opacity;
            const invA = 1 - a;

            const R_scale = invA + r * a;
            const G_scale = invA + g * a;
            const B_scale = invA + b * a;

            return `
        ${R_scale} 0 0 0 0
        0 ${G_scale} 0 0 0
        0 0 ${B_scale} 0 0
        0 0 0 1 0
      `;
        }

        return null;
    }, [enabled, mode, color, opacity]);

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
