<?php

namespace App\Enums;

enum MessageSender: string
{
    case User = 'user';
    case Assistant = 'assistant';
}
