import { Component, HostListener, OnDestroy, OnInit } from "@angular/core";
import { combineLatest, BehaviorSubject, Subscription } from "rxjs";
import { compactMode, sidebarCollapsed } from "../../components/command-bar/command-bar.component";
import { AppProviderService } from "../../services/app-provider.service";

// Below this window width the sidebar hides itself so the session list keeps usable space
export const sidebarAutoHideWidth = 900;
// Below this session list width the table switches to the compact layout
export const compactListWidth = 700;
// Keep in sync with $menubar-width in global.scss
const sidebarWidth = 240;

@Component({
  selector: "app-main-layout",
  templateUrl: "./main-layout.component.html",
  styleUrls: ["./main-layout.component.scss"],
})
export class MainLayoutComponent implements OnInit, OnDestroy {
  compactMode: boolean;
  sidebarVisible = true;

  private windowWidth$ = new BehaviorSubject<number>(window.innerWidth);
  private subscription: Subscription;

  constructor(private appProviderService: AppProviderService) {}

  @HostListener("window:resize")
  onWindowResize(): void {
    this.windowWidth$.next(window.innerWidth);
  }

  ngOnInit(): void {
    this.subscription = combineLatest([sidebarCollapsed, this.windowWidth$]).subscribe(([collapsed, windowWidth]) => {
      this.sidebarVisible = !collapsed && windowWidth >= sidebarAutoHideWidth;
      const listWidth = windowWidth - (this.sidebarVisible ? sidebarWidth : 0);
      const compact = listWidth < compactListWidth;
      if (compact !== compactMode.value) {
        compactMode.next(compact);
      }
      this.compactMode = compact;
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  clearOptionBarIds(): void {
    this.appProviderService.behaviouralSubjectService.unselectSessions();
  }
}
