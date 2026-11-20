package com.example.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ui.theme.CrimsonBrake
import com.example.ui.theme.EmeraldGas
import com.example.ui.theme.NeonCyan
import com.example.ui.theme.ObsidianBg
import com.example.ui.theme.SlateSurface
import com.example.ui.theme.TashkentGold
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.roundToInt
import kotlin.math.sin

private data class Vec3(val x: Float, val y: Float, val z: Float) {
    operator fun minus(o: Vec3) = Vec3(x - o.x, y - o.y, z - o.z)
    operator fun plus(o: Vec3) = Vec3(x + o.x, y + o.y, z + o.z)
    fun dot(o: Vec3) = x * o.x + y * o.y + z * o.z
    fun cross(o: Vec3) = Vec3(y * o.z - z * o.y, z * o.x - x * o.z, x * o.y - y * o.x)
    fun norm(): Vec3 {
        val l = hypot(hypot(x, y), z).coerceAtLeast(0.0001f)
        return Vec3(x / l, y / l, z / l)
    }
}

private class Cam3D(
    val pos: Vec3,
    val right: Vec3,
    val up: Vec3,
    val forward: Vec3,
    val halfW: Float,
    val halfH: Float,
    val focal: Float
) {
    fun toCam(p: Vec3): Vec3 {
        val rel = p - pos
        return Vec3(rel.dot(right), rel.dot(up), rel.dot(forward))
    }

    fun projectCam(c: Vec3): Offset =
        Offset(halfW + (c.x / c.z) * focal, halfH - (c.y / c.z) * focal)

    fun projectWorld(p: Vec3): Offset? {
        val c = toCam(p)
        if (c.z < 0.6f) return null
        return projectCam(c)
    }

    fun clipQuad(pts: List<Vec3>): List<Offset>? {
        val camPts = pts.map { toCam(it) }
        val near = 0.6f
        val clipped = mutableListOf<Vec3>()
        for (i in camPts.indices) {
            val a = camPts[i]
            val b = camPts[(i + 1) % camPts.size]
            val aIn = a.z >= near
            val bIn = b.z >= near
            if (aIn) clipped.add(a)
            if (aIn != bIn) {
                val t = (near - a.z) / (b.z - a.z)
                clipped.add(Vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, near))
            }
        }
        if (clipped.size < 3) return null
        return clipped.map { projectCam(it) }
    }
}

private data class Drawable3D(val distSq: Float, val draw: DrawScope.(Cam3D) -> Unit)

@Composable
fun SandboxScreen(
    state: GameUiState,
    viewModel: GameViewModel,
    modifier: Modifier = Modifier
) {
    var showTuningDialog by remember { mutableStateOf(false) }
    val activeCar = state.cars.find { it.id == state.activeCarId }
    val tuningTargetCar = activeCar ?: state.cars.first()

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(ObsidianBg)
    ) {
        // 1. 3D Perspective Tashkent City Canvas
        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .testTag("city_sandbox_canvas")
        ) {
            val w = size.width
            val h = size.height
            val dist = if (activeCar != null) 9.0f else 6.2f
            val target = Vec3(state.playerX, if (activeCar != null) 1.3f else 1.4f, state.playerZ)
            val horiz = dist * cos(state.cameraPitch)
            val camPos = Vec3(
                target.x + sin(state.cameraYaw) * horiz,
                target.y + dist * sin(state.cameraPitch) + 1.4f,
                target.z + cos(state.cameraYaw) * horiz
            )
            val forward = (target - camPos).norm()
            val right = forward.cross(Vec3(0f, 1f, 0f)).norm()
            val up = right.cross(forward).norm()
            val cam = Cam3D(camPos, right, up, forward, w / 2f, h / 2f, w * 0.92f)

            // Sky + Horizon
            val horizonY = (h / 2f - (up.y.coerceIn(-1f, 1f) * 0f) + forward.y * cam.focal).coerceIn(0f, h)
            drawRect(
                brush = Brush.verticalGradient(
                    colors = listOf(Color(0xFF0C4A6E), Color(0xFF38BDF8), Color(0xFFBAE6FD)),
                    startY = 0f,
                    endY = horizonY.coerceAtLeast(1f)
                ),
                size = Size(w, horizonY)
            )
            drawRect(
                brush = Brush.verticalGradient(
                    colors = listOf(Color(0xFF334155), Color(0xFF1E293B)),
                    startY = horizonY,
                    endY = h
                ),
                topLeft = Offset(0f, horizonY),
                size = Size(w, (h - horizonY).coerceAtLeast(0f))
            )

            // 3D Roads (North-South & East-West avenues)
            drawRoadStrip(cam, -5f, 5f, -95f, 95f, Color(0xFF111827), northSouth = true)
            drawRoadStrip(cam, -95f, 95f, -5f, 5f, Color(0xFF111827), northSouth = false)

            // Collect 3D scene objects & sort far-to-near (Painter's algorithm)
            val items = mutableListOf<Drawable3D>()

            fun distToCam(x: Float, z: Float): Float {
                val dx = x - camPos.x
                val dz = z - camPos.z
                return dx * dx + dz * dz
            }

            // City Buildings
            val buildings = listOf(
                Triple(-22f, -22f, Vec3(14f, 18f, 14f)),
                Triple(22f, -24f, Vec3(14f, 24f, 16f)),
                Triple(-24f, 22f, Vec3(16f, 14f, 14f)),
                Triple(22f, 22f, Vec3(14f, 20f, 14f)),
                Triple(-48f, -24f, Vec3(18f, 28f, 16f)),
                Triple(46f, 24f, Vec3(16f, 22f, 18f))
            )
            buildings.forEach { (bx, bz, bSize) ->
                items.add(Drawable3D(distToCam(bx, bz)) { c ->
                    drawBox3D(c, Vec3(bx, 0f, bz), bSize.x, bSize.y, bSize.z, 0f, Color(0xFF475569), Color(0xFF334155), Color(0xFF64748B))
                })
            }

            // Toshkent Teleminorasi (3D Tower)
            val tx = 38f
            val tz = -48f
            items.add(Drawable3D(distToCam(tx, tz)) { c ->
                drawBox3D(c, Vec3(tx, 0f, tz), 6f, 12f, 6f, 0f, TashkentGold, Color(0xFFD97706), Color(0xFFFBBF24))
                drawBox3D(c, Vec3(tx, 12f, tz), 2.5f, 26f, 2.5f, 0f, Color(0xFFE2E8F0), Color(0xFF94A3B8), Color(0xFFFFFFFF))
                drawBox3D(c, Vec3(tx, 26f, tz), 5.5f, 4f, 5.5f, 0f, NeonCyan, Color(0xFF0284C7), NeonCyan)
                drawBox3D(c, Vec3(tx, 38f, tz), 0.8f, 16f, 0.8f, 0f, Color.White, Color(0xFFCBD5E1), Color.White)
            })

            // Registon Maydoni (Turquoise Domes & Portal)
            val rx = -46f
            val rz = -46f
            items.add(Drawable3D(distToCam(rx, rz)) { c ->
                drawBox3D(c, Vec3(rx, 0f, rz), 18f, 9f, 10f, 0f, Color(0xFFD97706), Color(0xFFB45309), Color(0xFFF59E0B))
                drawBox3D(c, Vec3(rx - 5f, 9f, rz), 5f, 5f, 5f, 0f, Color(0xFF0284C7), Color(0xFF0369A1), Color(0xFF38BDF8))
                drawBox3D(c, Vec3(rx + 5f, 9f, rz), 5f, 5f, 5f, 0f, Color(0xFF0284C7), Color(0xFF0369A1), Color(0xFF38BDF8))
            })

            // NPCs & Traffic
            state.npcs.forEach { npc ->
                items.add(Drawable3D(distToCam(npc.x, npc.z)) { c ->
                    if (npc.isCar) {
                        draw3DCar(c, npc.x, npc.z, npc.yaw, npc.color, 0f, isVan = false, damaged = false)
                    } else {
                        drawBox3D(c, Vec3(npc.x, 0f, npc.z), 0.55f, 1.55f, 0.45f, npc.yaw, npc.color, npc.color.copy(alpha = 0.75f), Color.White)
                    }
                })
            }

            // Drivable Cars (Gentra, Nexia 2, Damas)
            state.cars.forEach { car ->
                items.add(Drawable3D(distToCam(car.x, car.z)) { c ->
                    draw3DCar(c, car.x, car.z, car.yaw, car.color, car.steerAngle, car.isVan, car.hp < 85f)
                })
            }

            // Player (on foot)
            if (state.activeCarId == null) {
                items.add(Drawable3D(distToCam(state.playerX, state.playerZ)) { c ->
                    drawBox3D(c, Vec3(state.playerX, 0f, state.playerZ), 0.55f, 1.2f, 0.4f, state.playerYaw, NeonCyan, Color(0xFF0284C7), Color(0xFF67E8F9))
                    drawBox3D(c, Vec3(state.playerX, 1.2f, state.playerZ), 0.4f, 0.45f, 0.4f, state.playerYaw, Color(0xFFFDE68A), Color(0xFFF59E0B), Color(0xFFFEF3C7))
                })
            }

            items.sortByDescending { it.distSq }
            items.forEach { it.draw(this, cam) }
        }

        // Right-side 360 Camera Drag Zone (behind HUD buttons)
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .fillMaxWidth(0.55f)
                .align(Alignment.CenterEnd)
                .pointerInput(Unit) {
                    detectDragGestures { change, dragAmount ->
                        change.consume()
                        viewModel.orbitCamera(
                            deltaYaw = -dragAmount.x * 0.007f,
                            deltaPitch = dragAmount.y * 0.005f
                        )
                    }
                }
                .testTag("camera_orbit_zone")
        )

        // 2. Top HUD Bar (Vehicle selector, Speed/HP/Plate, Tuning/Radio/Repair)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.TopCenter)
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    state.cars.forEach { car ->
                        val selected = state.activeCarId == car.id
                        FilterChip(
                            selected = selected,
                            onClick = { viewModel.selectAndEnterCar(car.id) },
                            label = {
                                Text(
                                    text = car.id.replaceFirstChar { it.uppercase() },
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = NeonCyan.copy(alpha = 0.25f),
                                selectedLabelColor = NeonCyan
                            ),
                            modifier = Modifier.testTag("car_chip_${car.id}")
                        )
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    IconButton(
                        onClick = { viewModel.toggleRadio() },
                        modifier = Modifier
                            .minimumInteractiveComponentSize()
                            .background(
                                if (state.radioOn) EmeraldGas.copy(alpha = 0.25f) else SlateSurface,
                                CircleShape
                            )
                            .testTag("radio_toggle_button")
                    ) {
                        Icon(
                            imageVector = Icons.Default.MusicNote,
                            contentDescription = "Radio",
                            tint = if (state.radioOn) EmeraldGas else Color.White
                        )
                    }

                    IconButton(
                        onClick = { showTuningDialog = true },
                        modifier = Modifier
                            .minimumInteractiveComponentSize()
                            .background(SlateSurface, CircleShape)
                            .testTag("tuning_button")
                    ) {
                        Icon(
                            imageVector = Icons.Default.Palette,
                            contentDescription = "Nomer va Rang",
                            tint = TashkentGold
                        )
                    }
                }
            }

            Surface(
                color = SlateSurface.copy(alpha = 0.88f),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    val speedKmh = ((abs(activeCar?.speed ?: 0f)) * 3.6f).roundToInt()
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "$speedKmh km/h",
                            color = NeonCyan,
                            fontWeight = FontWeight.ExtraBold,
                            fontSize = 15.sp
                        )
                        Text(
                            text = state.statusBanner,
                            color = Color(0xFFCBD5E1),
                            fontSize = 11.sp
                        )
                    }

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Surface(
                            color = Color.White,
                            shape = RoundedCornerShape(6.dp),
                            border = androidx.compose.foundation.BorderStroke(1.5.dp, Color.Black)
                        ) {
                            Text(
                                text = "${tuningTargetCar.plateRegion} | ${tuningTargetCar.plateNumber}",
                                color = Color.Black,
                                fontFamily = FontFamily.Monospace,
                                fontWeight = FontWeight.Black,
                                fontSize = 11.sp,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 3.dp)
                            )
                        }

                        if (tuningTargetCar.hp < 99f) {
                            IconButton(
                                onClick = { viewModel.repairActiveCar() },
                                modifier = Modifier
                                    .size(36.dp)
                                    .background(CrimsonBrake.copy(alpha = 0.25f), CircleShape)
                                    .testTag("repair_car_button")
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Build,
                                    contentDescription = "Ta'mirlash",
                                    tint = Color.White,
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                        }
                    }
                }
            }

            if (activeCar != null) {
                LinearProgressIndicator(
                    progress = { (activeCar.hp / 100f).coerceIn(0f, 1f) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(5.dp)
                        .clip(RoundedCornerShape(99.dp)),
                    color = when {
                        activeCar.hp > 60f -> EmeraldGas
                        activeCar.hp > 30f -> TashkentGold
                        else -> CrimsonBrake
                    },
                    trackColor = SlateSurface
                )
            }
        }

        // 3. Bottom Controls
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.BottomCenter)
                .padding(horizontal = 16.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Bottom
        ) {
            if (activeCar == null) {
                VirtualJoystick(
                    onMove = { dx, dy -> viewModel.setJoystick(dx, dy) },
                    modifier = Modifier.testTag("walk_joystick")
                )
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    HoldControlButton(
                        label = "◀",
                        bg = SlateSurface.copy(alpha = 0.85f),
                        border = NeonCyan,
                        onHoldChanged = { viewModel.setSteer(left = it) },
                        modifier = Modifier
                            .size(64.dp)
                            .testTag("steer_left_button")
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                            contentDescription = "Chapga burish",
                            tint = Color.White,
                            modifier = Modifier.size(32.dp)
                        )
                    }
                    HoldControlButton(
                        label = "▶",
                        bg = SlateSurface.copy(alpha = 0.85f),
                        border = NeonCyan,
                        onHoldChanged = { viewModel.setSteer(right = it) },
                        modifier = Modifier
                            .size(64.dp)
                            .testTag("steer_right_button")
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                            contentDescription = "O'ngga burish",
                            tint = Color.White,
                            modifier = Modifier.size(32.dp)
                        )
                    }
                }
            }

            Column(
                horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                if (state.activeCarId != null || state.nearbyCarId != null) {
                    Button(
                        onClick = { viewModel.toggleEnterExit() },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = TashkentGold,
                            contentColor = ObsidianBg
                        ),
                        shape = RoundedCornerShape(14.dp),
                        modifier = Modifier
                            .minimumInteractiveComponentSize()
                            .testTag("enter_exit_car_button")
                    ) {
                        Icon(
                            imageVector = Icons.Default.DirectionsCar,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = if (state.activeCarId != null) "TUSHISH" else "MINISH",
                            fontWeight = FontWeight.Black
                        )
                    }
                }

                if (activeCar != null) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.Bottom
                    ) {
                        HoldControlButton(
                            label = "TORMOZ",
                            bg = CrimsonBrake.copy(alpha = 0.72f),
                            border = Color(0xFFFCA5A5),
                            onHoldChanged = { viewModel.setBrake(it) },
                            modifier = Modifier
                                .width(66.dp)
                                .height(68.dp)
                                .testTag("brake_pedal_button")
                        )
                        HoldControlButton(
                            label = "GAZ",
                            bg = EmeraldGas.copy(alpha = 0.78f),
                            border = Color(0xFF6EE7B7),
                            onHoldChanged = { viewModel.setGas(it) },
                            modifier = Modifier
                                .width(66.dp)
                                .height(88.dp)
                                .testTag("gas_pedal_button")
                        )
                    }
                }
            }
        }
    }

    if (showTuningDialog) {
        TuningDialog(
            car = tuningTargetCar,
            onDismiss = { showTuningDialog = false },
            onApply = { reg, num, col ->
                viewModel.updateCarTuning(tuningTargetCar.id, reg, num, col)
                showTuningDialog = false
            }
        )
    }
}

private fun DrawScope.drawRoadStrip(
    cam: Cam3D,
    xMin: Float,
    xMax: Float,
    zMin: Float,
    zMax: Float,
    color: Color,
    northSouth: Boolean
) {
    val segs = 12
    for (i in 0 until segs) {
        val t0 = i.toFloat() / segs
        val t1 = (i + 1).toFloat() / segs
        val quad = if (northSouth) {
            val z0 = zMin + (zMax - zMin) * t0
            val z1 = zMin + (zMax - zMin) * t1
            listOf(Vec3(xMin, 0.02f, z0), Vec3(xMax, 0.02f, z0), Vec3(xMax, 0.02f, z1), Vec3(xMin, 0.02f, z1))
        } else {
            val x0 = xMin + (xMax - xMin) * t0
            val x1 = xMin + (xMax - xMin) * t1
            listOf(Vec3(x0, 0.01f, zMin), Vec3(x1, 0.01f, zMin), Vec3(x1, 0.01f, zMax), Vec3(x0, 0.01f, zMax))
        }
        val pts = cam.clipQuad(quad) ?: continue
        val path = Path().apply {
            moveTo(pts[0].x, pts[0].y)
            for (k in 1 until pts.size) lineTo(pts[k].x, pts[k].y)
            close()
        }
        drawPath(path, color = color)

        // Sariq markaziy chiziq
        if (i % 2 == 0) {
            val lineQuad = if (northSouth) {
                val z0 = zMin + (zMax - zMin) * t0
                val z1 = zMin + (zMax - zMin) * (t0 + 0.04f)
                listOf(Vec3(-0.18f, 0.04f, z0), Vec3(0.18f, 0.04f, z0), Vec3(0.18f, 0.04f, z1), Vec3(-0.18f, 0.04f, z1))
            } else {
                val x0 = xMin + (xMax - xMin) * t0
                val x1 = xMin + (xMax - xMin) * (t0 + 0.04f)
                listOf(Vec3(x0, 0.03f, -0.18f), Vec3(x1, 0.03f, -0.18f), Vec3(x1, 0.03f, 0.18f), Vec3(x0, 0.03f, 0.18f))
            }
            cam.clipQuad(lineQuad)?.let { lpts ->
                val lp = Path().apply {
                    moveTo(lpts[0].x, lpts[0].y)
                    for (k in 1 until lpts.size) lineTo(lpts[k].x, lpts[k].y)
                    close()
                }
                drawPath(lp, color = Color(0xFFFACC15))
            }
        }
    }
}

private fun DrawScope.draw3DCar(
    cam: Cam3D,
    x: Float,
    z: Float,
    yaw: Float,
    color: Color,
    steerAngle: Float,
    isVan: Boolean,
    damaged: Boolean
) {
    val w = if (isVan) 1.75f else 1.9f
    val l = if (isVan) 3.7f else 4.3f
    val bodyH = if (isVan) 1.0f else 0.7f
    // Pastki kuzov
    drawBox3D(cam, Vec3(x, 0.3f, z), w, bodyH, l, yaw, color, color.copy(alpha = 0.8f), color)
    // Shisha kabina
    drawBox3D(
        cam,
        Vec3(x, 0.3f + bodyH, z),
        w * 0.85f,
        if (isVan) 0.7f else 0.52f,
        if (isVan) l * 0.78f else l * 0.52f,
        yaw,
        Color(0xFF0F172A),
        Color(0xFF1E293B),
        color
    )
    // 4 ta balon (oldingilari steerAngle bilan buriladi)
    val wheelOffsets = listOf(
        Triple(-w * 0.48f, -l * 0.32f, yaw + steerAngle),
        Triple(w * 0.48f, -l * 0.32f, yaw + steerAngle),
        Triple(-w * 0.48f, l * 0.32f, yaw),
        Triple(w * 0.48f, l * 0.32f, yaw)
    )
    val cosY = cos(yaw)
    val sinY = sin(yaw)
    wheelOffsets.forEach { (ox, oz, wYaw) ->
        val wx = x + ox * cosY + oz * sinY
        val wz = z - ox * sinY + oz * cosY
        drawBox3D(cam, Vec3(wx, 0f, wz), 0.28f, 0.62f, 0.62f, wYaw, Color(0xFF020617), Color(0xFF111827), Color(0xFF334155))
    }
    if (damaged) {
        cam.projectWorld(Vec3(x, 1.8f, z))?.let { p ->
            drawCircle(color = CrimsonBrake.copy(alpha = 0.7f), radius = 8f, center = p)
        }
    }
}

private fun DrawScope.drawBox3D(
    cam: Cam3D,
    baseCenter: Vec3,
    w: Float,
    h: Float,
    l: Float,
    yaw: Float,
    frontColor: Color,
    sideColor: Color,
    topColor: Color
) {
    val hw = w / 2f
    val hl = l / 2f
    val c = cos(yaw)
    val s = sin(yaw)

    fun pt(lx: Float, ly: Float, lz: Float) = Vec3(
        baseCenter.x + lx * c + lz * s,
        baseCenter.y + ly,
        baseCenter.z - lx * s + lz * c
    )

    val v = listOf(
        pt(-hw, 0f, -hl), pt(hw, 0f, -hl), pt(hw, h, -hl), pt(-hw, h, -hl), // 0..3 front (-z)
        pt(-hw, 0f, hl), pt(hw, 0f, hl), pt(hw, h, hl), pt(-hw, h, hl)      // 4..7 back (+z)
    )

    val faces = listOf(
        Triple(listOf(v[0], v[1], v[2], v[3]), frontColor, "f"),
        Triple(listOf(v[5], v[4], v[7], v[6]), frontColor, "b"),
        Triple(listOf(v[4], v[0], v[3], v[7]), sideColor, "l"),
        Triple(listOf(v[1], v[5], v[6], v[2]), sideColor, "r"),
        Triple(listOf(v[3], v[2], v[6], v[7]), topColor, "t")
    )

    val sortedFaces = faces.map { (quad, col, _) ->
        val center = Vec3(
            quad.sumOf { it.x.toDouble() }.toFloat() / 4f,
            quad.sumOf { it.y.toDouble() }.toFloat() / 4f,
            quad.sumOf { it.z.toDouble() }.toFloat() / 4f
        )
        val d = center - cam.pos
        Triple(d.dot(d), quad, col)
    }.sortedByDescending { it.first }

    sortedFaces.forEach { (_, quad, col) ->
        val pts = cam.clipQuad(quad) ?: return@forEach
        val path = Path().apply {
            moveTo(pts[0].x, pts[0].y)
            for (i in 1 until pts.size) lineTo(pts[i].x, pts[i].y)
            close()
        }
        drawPath(path, color = col)
        drawPath(path, color = Color.Black.copy(alpha = 0.25f), style = Stroke(width = 1.2f))
    }
}

@Composable
private fun VirtualJoystick(
    onMove: (Float, Float) -> Unit,
    modifier: Modifier = Modifier
) {
    var knobX by remember { mutableFloatStateOf(0f) }
    var knobY by remember { mutableFloatStateOf(0f) }
    val maxDistPx = 110f

    Box(
        modifier = modifier
            .size(122.dp)
            .clip(CircleShape)
            .background(SlateSurface.copy(alpha = 0.65f))
            .border(2.dp, NeonCyan.copy(alpha = 0.55f), CircleShape)
            .pointerInput(Unit) {
                detectDragGestures(
                    onDragEnd = {
                        knobX = 0f
                        knobY = 0f
                        onMove(0f, 0f)
                    },
                    onDragCancel = {
                        knobX = 0f
                        knobY = 0f
                        onMove(0f, 0f)
                    }
                ) { change, dragAmount ->
                    change.consume()
                    var nx = knobX + dragAmount.x
                    var ny = knobY + dragAmount.y
                    val d = hypot(nx, ny)
                    if (d > maxDistPx) {
                        nx = (nx / d) * maxDistPx
                        ny = (ny / d) * maxDistPx
                    }
                    knobX = nx
                    knobY = ny
                    onMove(nx / maxDistPx, ny / maxDistPx)
                }
            },
        contentAlignment = Alignment.Center
    ) {
        Box(
            modifier = Modifier
                .offset { IntOffset(knobX.roundToInt(), knobY.roundToInt()) }
                .size(48.dp)
                .clip(CircleShape)
                .background(NeonCyan)
                .border(2.dp, Color.White, CircleShape)
        )
    }
}

@Composable
private fun HoldControlButton(
    label: String,
    bg: Color,
    border: Color,
    onHoldChanged: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    content: (@Composable () -> Unit)? = null
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(16.dp))
            .background(bg)
            .border(2.dp, border, RoundedCornerShape(16.dp))
            .pointerInput(Unit) {
                detectTapGestures(
                    onPress = {
                        onHoldChanged(true)
                        try {
                            awaitRelease()
                        } finally {
                            onHoldChanged(false)
                        }
                    }
                )
            },
        contentAlignment = Alignment.Center
    ) {
        if (content != null) {
            content()
        } else {
            Text(
                text = label,
                color = Color.White,
                fontSize = 12.sp,
                fontWeight = FontWeight.ExtraBold
            )
        }
    }
}

@Composable
private fun TuningDialog(
    car: CarEntity,
    onDismiss: () -> Unit,
    onApply: (String, String, Color) -> Unit
) {
    var region by remember { mutableStateOf(car.plateRegion) }
    var number by remember { mutableStateOf(car.plateNumber) }
    var selectedColor by remember { mutableStateOf(car.color) }

    val palette = listOf(
        Color(0xFFF8FAFC),
        Color(0xFF111827),
        Color(0xFF94A3B8),
        Color(0xFF2563EB),
        Color(0xFFDC2626),
        Color(0xFF059669),
        Color(0xFFF59E0B)
    )

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = SlateSurface,
        title = { Text("${car.name}: Nomer & Rang", color = NeonCyan, fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Surface(
                    color = Color.White,
                    shape = RoundedCornerShape(8.dp),
                    border = androidx.compose.foundation.BorderStroke(2.dp, Color.Black),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "${region.padStart(2, '0')} | ${number.uppercase()}",
                            color = Color.Black,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Black,
                            fontSize = 18.sp
                        )
                        Text(
                            text = "UZ",
                            color = Color(0xFF0284C7),
                            fontWeight = FontWeight.Black,
                            fontSize = 13.sp
                        )
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = region,
                        onValueChange = { region = it.filter { ch -> ch.isDigit() }.take(2) },
                        label = { Text("Kod") },
                        singleLine = true,
                        modifier = Modifier.width(84.dp)
                    )
                    OutlinedTextField(
                        value = number,
                        onValueChange = { number = it.take(9).uppercase() },
                        label = { Text("Davlat raqami") },
                        singleLine = true,
                        modifier = Modifier.weight(1f)
                    )
                }

                Text("Kuzov rangi:", style = MaterialTheme.typography.labelLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    palette.forEach { col ->
                        val isSel = col == selectedColor
                        Box(
                            modifier = Modifier
                                .size(34.dp)
                                .clip(CircleShape)
                                .background(col)
                                .border(
                                    width = if (isSel) 3.dp else 1.5.dp,
                                    color = if (isSel) NeonCyan else Color.White.copy(alpha = 0.4f),
                                    shape = CircleShape
                                )
                                .clickable { selectedColor = col }
                        )
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onApply(region, number, selectedColor) },
                modifier = Modifier.testTag("apply_tuning_button")
            ) {
                Text("Saqlash")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Bekor qilish")
            }
        }
    )
}
