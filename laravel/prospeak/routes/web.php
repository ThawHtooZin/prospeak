<?php

use App\Http\Controllers\Api\ChatController;
use App\Http\Controllers\ChatPageController;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;
use Laravel\Fortify\Features;

Route::get('/', function () {
    return Inertia::render('welcome', [
        'canRegister' => Features::enabled(Features::registration()),
    ]);
})->name('home');

Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('dashboard', function () {
        return Inertia::render('dashboard');
    })->name('dashboard');

    Route::get('chats/{chat}', [ChatPageController::class, 'show'])->name('chats.show');

    Route::prefix('api/v1')->group(function () {
        Route::get('chats', [ChatController::class, 'index'])->name('chats.index');
        Route::post('chats', [ChatController::class, 'store'])->name('chats.store');
        Route::get('chats/{chat}', [ChatController::class, 'show'])->name('chats.api.show');
        Route::patch('chats/{chat}/settings', [ChatController::class, 'updateSettings'])->name('chats.settings');
        Route::post('chats/{chat}/messages', [ChatController::class, 'storeMessage'])->name('chats.messages.store');
    });
});

require __DIR__.'/settings.php';
