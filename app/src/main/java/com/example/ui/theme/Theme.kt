package com.example.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

private val UzbekGtaDarkScheme = darkColorScheme(
    primary = NeonCyan,
    onPrimary = ObsidianBg,
    secondary = TashkentGold,
    onSecondary = ObsidianBg,
    tertiary = EmeraldGas,
    onTertiary = ObsidianBg,
    background = ObsidianBg,
    onBackground = TextPrimary,
    surface = SlateSurface,
    onSurface = TextPrimary,
    surfaceVariant = SlateVariant,
    onSurfaceVariant = TextSecondary,
    error = CrimsonBrake,
    onError = TextPrimary
)

@Composable
fun UzbekCityGtaTheme(
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = UzbekGtaDarkScheme,
        typography = Typography,
        content = content
    )
}
