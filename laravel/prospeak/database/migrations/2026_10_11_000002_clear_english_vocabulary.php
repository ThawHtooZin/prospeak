<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('chat_messages')->whereNotNull('vocabulary')->update(['vocabulary' => null]);
    }

    public function down(): void
    {
        //
    }
};
