package com.example

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.SportsEsports
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.ui.GameViewModel
import com.example.ui.ProjectGuideScreen
import com.example.ui.SandboxScreen
import com.example.ui.theme.SlateSurface
import com.example.ui.theme.UzbekCityGtaTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            UzbekCityGtaTheme {
                val gameViewModel: GameViewModel = viewModel()
                val uiState by gameViewModel.uiState.collectAsStateWithLifecycle()
                var selectedTab by rememberSaveable { mutableIntStateOf(0) }

                Scaffold(
                    modifier = Modifier.fillMaxSize(),
                    contentWindowInsets = WindowInsets.safeDrawing,
                    bottomBar = {
                        NavigationBar(containerColor = SlateSurface) {
                            NavigationBarItem(
                                selected = selectedTab == 0,
                                onClick = { selectedTab = 0 },
                                icon = {
                                    Icon(
                                        imageVector = Icons.Default.SportsEsports,
                                        contentDescription = stringResource(R.string.tab_sandbox)
                                    )
                                },
                                label = { Text(stringResource(R.string.tab_sandbox)) },
                                modifier = Modifier.testTag("nav_tab_sandbox")
                            )
                            NavigationBarItem(
                                selected = selectedTab == 1,
                                onClick = { selectedTab = 1 },
                                icon = {
                                    Icon(
                                        imageVector = Icons.Default.Code,
                                        contentDescription = stringResource(R.string.tab_project)
                                    )
                                },
                                label = { Text(stringResource(R.string.tab_project)) },
                                modifier = Modifier.testTag("nav_tab_project")
                            )
                        }
                    }
                ) { innerPadding ->
                    Box(modifier = Modifier.padding(innerPadding)) {
                        if (selectedTab == 0) {
                            SandboxScreen(
                                state = uiState,
                                viewModel = gameViewModel
                            )
                        } else {
                            ProjectGuideScreen(
                                checklist = uiState.checklist,
                                onToggleItem = { gameViewModel.toggleChecklistItem(it) }
                            )
                        }
                    }
                }
            }
        }
    }
}
